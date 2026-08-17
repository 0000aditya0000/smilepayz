const payoutService = require("../services/smilepayz.payout.service");
const smilepayzService = require("../services/smilepayz.service");
const logger = require("../utils/logger");
const db = require("../config/database");
const config = require("../config/smilepayz");
const { validatePayoutRequest, validateBalanceRequest, ValidationError } = require("../utils/validator");
const { verifySmilepayzCallbackSignature } = require("../services/smilepayz.signature");
const { mapSmilepayzPayoutStatus } = require("../utils/mapper");
const { EVENTS, INTERNAL_STATUS } = require("../constants");

const createPayoutHandler = async (req, res) => {
  try {
    const parsed = validatePayoutRequest(req.body);
    logger.info("Payout:createPayoutHandler", "Initiating payout", {
      withdrawId: parsed.withdrawId,
      amount: parsed.amount,
    });

    const response = await payoutService.createPayout({
      ...parsed,
      requestId: req.requestId,
      correlationId: req.correlationId,
    });

    const usedMOrderId = response.usedMOrderId;
    try {
      const [updateResult] = await db.execute(
        "UPDATE withdrawl SET morder_id = ? WHERE id = ?",
        [usedMOrderId, parsed.withdrawId]
      );
      if (updateResult.affectedRows === 0) {
        logger.warn("Payout:createPayoutHandler", "DB UPDATE matched 0 rows — withdrawId may not exist", {
          withdrawId: parsed.withdrawId,
          usedMOrderId,
        });
      }
    } catch (dbErr) {
      logger.logError(
        "Payout:createPayoutHandler",
        `CRITICAL: Payout created at Smilepayz but DB update failed — manual fix required | withdrawId=${parsed.withdrawId} | orderNo=${usedMOrderId}`,
        dbErr
      );
    }

    return res.json({
      success: true,
      mOrderId: usedMOrderId,
      orderNo: usedMOrderId,
      payOrderId: response.providerOrderId,
      data: response,
    });
  } catch (error) {
    const status = error instanceof ValidationError ? error.statusCode : 500;
    logger.logError("Payout:createPayoutHandler", error.message, error, {
      requestId: req.requestId,
    });
    return res.status(status).json({ success: false, error: error.message });
  }
};

const getMerchantBalanceHandler = async (req, res) => {
  try {
    const parsed = validateBalanceRequest(req.body || req.query, config.payoutAccountNo || config.accountNo);
    const response = await smilepayzService.inquiryBalance({
      ...parsed,
      requestId: req.requestId,
      correlationId: req.correlationId,
    });
    return res.json({ success: true, data: response });
  } catch (error) {
    const status = error instanceof ValidationError ? error.statusCode : 500;
    logger.logError("Payout:getMerchantBalanceHandler", error.message, error, {
      requestId: req.requestId,
    });
    return res.status(status).json({ success: false, error: error.message });
  }
};

const payoutWebhookHandler = async (req, res) => {
  const requestId = req.requestId;
  const body = req.body || {};
  const orderNo = body.orderNo;
  const tradeNo = body.tradeNo;
  const correlationId = tradeNo || orderNo || req.correlationId;
  const timestamp = req.headers["x-timestamp"];
  const signature = req.headers["x-signature"];

  logger.event("INFO", "Payout:Webhook", EVENTS.CALLBACK_RECEIVED, {
    requestId,
    correlationId,
    callbackType: "payout",
    orderNo,
    tradeNo,
    status: body.status,
    amount: body.money?.amount,
    utr: body.utr,
    merchantId: body.merchantId,
    message: "Smilepayz pay-out callback received",
  });

  try {
    if (!orderNo || !tradeNo || !body.status) {
      logger.event("WARN", "Payout:Webhook", EVENTS.CALLBACK_REJECTED, {
        requestId,
        correlationId,
        reason: "missing_required_fields",
      });
      return res.status(400).send("INVALID");
    }

    const verification = verifySmilepayzCallbackSignature({
      tradeNo,
      timestamp,
      signature,
    });
    logger.logSignVerify("Payout:Webhook", signature, verification.verified);

    if (!verification.verified) {
      logger.event("ERROR", "Payout:Webhook", EVENTS.CALLBACK_SIGNATURE_FAILED, {
        requestId,
        correlationId,
        orderNo,
        tradeNo,
        reason: verification.reason,
        formula: verification.formula,
      });
      return res.status(401).send("INVALID_SIGNATURE");
    }

    logger.event("INFO", "Payout:Webhook", EVENTS.CALLBACK_SIGNATURE_VERIFIED, {
      requestId,
      correlationId,
      orderNo,
      tradeNo,
    });

    if (String(body.merchantId) !== String(config.partnerId)) {
      logger.event("ERROR", "Payout:Webhook", EVENTS.CALLBACK_REJECTED, {
        requestId,
        correlationId,
        reason: "merchant_mismatch",
        merchantId: body.merchantId,
      });
      return res.status(401).send("INVALID_MERCHANT");
    }

    const mapped = mapSmilepayzPayoutStatus(body.status);

    if (mapped.internal === INTERNAL_STATUS.SUCCESS) {
      const [updateResult] = await db.execute(
        "UPDATE withdrawl SET status = 1 WHERE morder_id = ? AND status != 1",
        [orderNo]
      );
      if (updateResult.affectedRows === 0) {
        logger.event("INFO", "Payout:Webhook", EVENTS.CALLBACK_DUPLICATE, {
          requestId,
          correlationId,
          orderNo,
          tradeNo,
          message: "Duplicate payout success callback",
        });
      } else {
        logger.event("INFO", "Payout:Webhook", EVENTS.TRANSACTION_STATUS_UPDATED, {
          requestId,
          correlationId,
          orderNo,
          tradeNo,
          utr: body.utr || null,
          status: 1,
        });
      }
    } else if (mapped.internal === INTERNAL_STATUS.FAILED) {
      const [updateResult] = await db.execute(
        "UPDATE withdrawl SET status = 2, rejected_by = 2 WHERE morder_id = ? AND status != 2",
        [orderNo]
      );
      if (updateResult.affectedRows === 0) {
        logger.warn("Payout:Webhook", "DB UPDATE matched 0 rows for failed payout", { orderNo });
      }
    } else {
      logger.event("INFO", "Payout:Webhook", EVENTS.CALLBACK_PROCESSED, {
        requestId,
        correlationId,
        orderNo,
        providerStatus: mapped.raw,
        internalStatus: mapped.internal,
        message: "Non-final payout callback acknowledged",
      });
    }

    return res.status(200).send("SUCCESS");
  } catch (error) {
    logger.logError("Payout:Webhook", "Unexpected error in payout webhook handler", error, {
      requestId,
      correlationId,
      orderNo,
    });
    return res.status(500).send("ERROR");
  }
};

module.exports = {
  createPayoutHandler,
  getMerchantBalanceHandler,
  payoutWebhookHandler,
};
