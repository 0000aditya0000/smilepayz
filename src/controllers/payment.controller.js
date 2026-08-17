const axios = require("axios");
const smilepayzService = require("../services/smilepayz.service");
const db = require("../config/database");
const config = require("../config/smilepayz");
const logger = require("../utils/logger");
const { validatePayinRequest, validateUserOrderRequest, ValidationError } = require("../utils/validator");
const { verifySmilepayzCallbackSignature } = require("../services/smilepayz.signature");
const { mapSmilepayzPayinStatus } = require("../utils/mapper");
const { EVENTS, INTERNAL_STATUS, toDbOrderStatus } = require("../constants");
const repo = require("../db/repository");

const pad = (n) => String(n).padStart(2, "0");

const insertRecharge = async ({ orderNo, amount, userId, userMobile, rechargeType, paymentMode, tradeNo }) => {
  const now = new Date();
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const query = `
    INSERT INTO recharge (
      recharge_id, order_id, userId, user_mobile, recharge_amount,
      recharge_type, payment_mode, date, time, silkpay_timestamp, recharge_status, isDepAdded
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  await db.execute(query, [
    orderNo,
    orderNo,
    userId || 0,
    userMobile || "",
    amount,
    rechargeType || "smilepayz",
    paymentMode || "smilepayz",
    date,
    time,
    tradeNo || Date.now(),
    "pending",
    0,
  ]);
};

const createPaymentHandler = async (req, res) => {
  try {
    const parsed = validatePayinRequest(req.body);
    const response = await smilepayzService.createPayin({
      ...parsed,
      requestId: req.requestId,
      correlationId: req.correlationId || parsed.orderNo,
    });
    return res.json({ success: true, data: response });
  } catch (error) {
    const status = error instanceof ValidationError ? error.statusCode : 500;
    logger.logError("PayIn:createPaymentHandler", error.message, error, {
      requestId: req.requestId,
      correlationId: req.correlationId,
    });
    return res.status(status).json({ success: false, error: error.message });
  }
};

const createUserOrderHandler = async (req, res) => {
  try {
    if (String(req.body.userId) === "23414") {
      return res.status(403).json({ success: false, error: "Recharge not allowed" });
    }

    const parsed = validateUserOrderRequest(req.body);
    const response = await smilepayzService.createPayin({
      ...parsed,
      requestId: req.requestId,
      correlationId: req.correlationId,
    });

    const paymentUrl = response.paymentUrl;
    if (!paymentUrl) {
      return res.status(500).json({
        success: false,
        error: "Failed to get payment URL from Smilepayz",
      });
    }

    try {
      await insertRecharge({
        orderNo: response.orderNo,
        amount: parsed.amount,
        userId: parsed.userId,
        userMobile: parsed.user_mobile,
        rechargeType: parsed.recharge_type,
        paymentMode: "smilepayz",
        tradeNo: response.providerOrderId,
      });
    } catch (dbErr) {
      if (dbErr?.code === "ER_DUP_ENTRY") {
        return res.status(409).json({ success: false, error: "Duplicate order number" });
      }
      logger.logError("PayIn:createUserOrderHandler", "SQL Error inserting recharge", dbErr, {
        requestId: req.requestId,
        orderNo: response.orderNo,
      });
      throw dbErr;
    }

    return res.json({ paymentUrl });
  } catch (error) {
    const status = error instanceof ValidationError ? error.statusCode : 500;
    logger.logError("PayIn:createUserOrderHandler", error.message, error, {
      requestId: req.requestId,
      correlationId: req.correlationId,
    });
    return res.status(status).json({ success: false, error: error.message });
  }
};

const getBalanceHandler = async (req, res) => {
  try {
    const { validateBalanceRequest } = require("../utils/validator");
    const parsed = validateBalanceRequest(req.body || req.query, config.payinAccountNo || config.accountNo);
    const response = await smilepayzService.inquiryBalance({
      ...parsed,
      requestId: req.requestId,
      correlationId: req.correlationId,
    });
    return res.json({ success: true, data: response });
  } catch (error) {
    const status = error instanceof ValidationError ? error.statusCode : 500;
    logger.logError("PayIn:getBalanceHandler", error.message, error, {
      requestId: req.requestId,
    });
    return res.status(status).json({ success: false, error: error.message });
  }
};

/**
 * Smilepayz pay-in callback.
 * Must return exact text SUCCESS after successful processing.
 */
const webhookHandler = async (req, res) => {
  const requestId = req.requestId;
  const body = req.body || {};
  const orderNo = body.orderNo;
  const tradeNo = body.tradeNo;
  const correlationId = tradeNo || orderNo || req.correlationId;
  const timestamp = req.headers["x-timestamp"];
  const signature = req.headers["x-signature"];

  logger.event("INFO", "PayIn:Webhook", EVENTS.CALLBACK_RECEIVED, {
    requestId,
    correlationId,
    callbackType: "payin",
    orderNo,
    tradeNo,
    status: body.status,
    amount: body.money?.amount,
    utr: body.utr,
    merchantId: body.merchantId,
    message: "Smilepayz pay-in callback received",
  });

  try {
    if (!orderNo || !tradeNo || !body.status) {
      logger.event("WARN", "PayIn:Webhook", EVENTS.CALLBACK_REJECTED, {
        requestId,
        correlationId,
        reason: "missing_required_fields",
      });
      await repo.createWebhookLog({
        request_id: requestId,
        correlation_id: correlationId,
        merchant_id: body.merchantId,
        order_no: orderNo,
        path: req.originalUrl,
        status: "rejected",
        error_message: "missing_required_fields",
        request_payload: body,
        processed: false,
        ip: req.ip,
      });
      return res.status(400).send("INVALID");
    }

    const verification = verifySmilepayzCallbackSignature({
      tradeNo,
      timestamp,
      signature,
    });
    logger.logSignVerify("PayIn:Webhook", signature, verification.verified);

    if (!verification.verified) {
      logger.event("ERROR", "PayIn:Webhook", EVENTS.CALLBACK_SIGNATURE_FAILED, {
        requestId,
        correlationId,
        orderNo,
        tradeNo,
        reason: verification.reason,
        formula: verification.formula,
        message: "Pay-in callback signature failed — transaction not updated",
      });
      await repo.createWebhookLog({
        request_id: requestId,
        correlation_id: correlationId,
        merchant_id: body.merchantId,
        order_no: orderNo,
        path: req.originalUrl,
        status: "signature_failed",
        gateway_status: body.status,
        signature_valid: false,
        error_message: verification.reason,
        request_payload: body,
        processed: false,
        ip: req.ip,
      });
      return res.status(401).send("INVALID_SIGNATURE");
    }

    logger.event("INFO", "PayIn:Webhook", EVENTS.CALLBACK_SIGNATURE_VERIFIED, {
      requestId,
      correlationId,
      orderNo,
      tradeNo,
    });

    if (String(body.merchantId) !== String(config.partnerId)) {
      logger.event("ERROR", "PayIn:Webhook", EVENTS.CALLBACK_REJECTED, {
        requestId,
        correlationId,
        reason: "merchant_mismatch",
        merchantId: body.merchantId,
      });
      await repo.createWebhookLog({
        request_id: requestId,
        correlation_id: correlationId,
        merchant_id: body.merchantId,
        order_no: orderNo,
        path: req.originalUrl,
        status: "rejected",
        signature_valid: true,
        error_message: "merchant_mismatch",
        request_payload: body,
        processed: false,
        ip: req.ip,
      });
      return res.status(401).send("INVALID_MERCHANT");
    }

    const mapped = mapSmilepayzPayinStatus(body.status);
    await repo.updatePaymentOrder(orderNo, {
      gateway_order_no: tradeNo,
      status: toDbOrderStatus(mapped.internal),
      utr: body.utr || undefined,
      raw_response: body,
      paid_at: mapped.internal === INTERNAL_STATUS.SUCCESS ? new Date() : undefined,
    });

    if (mapped.internal !== INTERNAL_STATUS.SUCCESS) {
      logger.event("INFO", "PayIn:Webhook", EVENTS.CALLBACK_PROCESSED, {
        requestId,
        correlationId,
        orderNo,
        tradeNo,
        status: mapped.internal,
        providerStatus: mapped.raw,
        message: "Non-success callback acknowledged without crediting",
      });
      if (mapped.internal === INTERNAL_STATUS.FAILED) {
        await db.execute(
          "UPDATE recharge SET recharge_status = 'failed' WHERE order_id = ? AND isDepAdded = 0",
          [orderNo]
        );
      }
      await repo.createWebhookLog({
        request_id: requestId,
        correlation_id: correlationId,
        merchant_id: config.partnerId,
        order_no: orderNo,
        path: req.originalUrl,
        status: mapped.internal,
        gateway_status: mapped.raw,
        signature_valid: true,
        request_payload: body,
        processed: true,
        ip: req.ip,
      });
      return res.status(200).send("SUCCESS");
    }

    const callbackAmount = Number(body.money?.amount);
    const [rows] = await db.execute(
      "SELECT userId, recharge_amount, recharge_status, isDepAdded FROM recharge WHERE order_id = ? LIMIT 1",
      [orderNo]
    );

    if (!rows.length) {
      logger.event("ERROR", "PayIn:Webhook", EVENTS.CALLBACK_REJECTED, {
        requestId,
        correlationId,
        reason: "unknown_orderNo",
        orderNo,
      });
      return res.status(404).send("ORDER_NOT_FOUND");
    }

    if (Number.isFinite(callbackAmount) && Number(rows[0].recharge_amount) !== callbackAmount) {
      logger.event("ERROR", "PayIn:Webhook", EVENTS.CALLBACK_REJECTED, {
        requestId,
        correlationId,
        reason: "amount_mismatch",
        expected: rows[0].recharge_amount,
        received: callbackAmount,
      });
      return res.status(400).send("AMOUNT_MISMATCH");
    }

    const [updateResult] = await db.execute(
      "UPDATE recharge SET recharge_status = 'success', isDepAdded = 1 WHERE order_id = ? AND isDepAdded = 0",
      [orderNo]
    );

    if (updateResult.affectedRows === 0) {
      logger.event("INFO", "PayIn:Webhook", EVENTS.CALLBACK_DUPLICATE, {
        requestId,
        correlationId,
        orderNo,
        tradeNo,
        message: "Duplicate pay-in callback — already processed",
      });
      return res.status(200).send("SUCCESS");
    }

    try {
      const userId = rows[0].userId;
      const rechargeAmount = parseFloat(rows[0].recharge_amount);
      const platformBaseURL = process.env.PLATFORM_BASE_URL || "https://api.rollix777.com";

      await axios.post(
        `${platformBaseURL}/api/user/deposit`,
        { userId, amount: rechargeAmount, cryptoname: "INR", orderid: orderNo },
        { headers: { "Content-Type": "application/json" }, timeout: 15000 }
      );

      const bonusAmount = rechargeAmount * 1.1;
      await axios.put(
        `${platformBaseURL}/api/user/wallet/balance`,
        { userId, cryptoname: "INR", balance: bonusAmount },
        { headers: { "Content-Type": "application/json" }, timeout: 15000 }
      );
    } catch (platformErr) {
      logger.logError(
        "PayIn:Webhook",
        `CRITICAL: Platform API failed for order ${orderNo} — manual intervention required`,
        platformErr,
        { requestId, correlationId, orderNo, tradeNo }
      );
    }

    logger.event("INFO", "PayIn:Webhook", EVENTS.TRANSACTION_STATUS_UPDATED, {
      requestId,
      correlationId,
      orderNo,
      tradeNo,
      utr: body.utr || null,
      status: "success",
      message: "Pay-in callback processed",
    });

    await repo.createWebhookLog({
      request_id: requestId,
      correlation_id: correlationId,
      merchant_id: config.partnerId,
      order_no: orderNo,
      path: req.originalUrl,
      status: "success",
      gateway_status: mapped.raw,
      signature_valid: true,
      request_payload: body,
      processed: true,
      ip: req.ip,
    });

    return res.status(200).send("SUCCESS");
  } catch (error) {
    logger.logError("PayIn:Webhook", "Unexpected error in webhook handler", error, {
      requestId,
      correlationId,
      orderNo,
    });
    return res.status(500).send("ERROR");
  }
};

module.exports = {
  createPaymentHandler,
  createUserOrderHandler,
  getBalanceHandler,
  webhookHandler,
};
