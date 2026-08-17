const config = require("../config/smilepayz");
const { postJson } = require("./smilepayz.client");
const { generateSmilepayzOrderNo, isValidSmilepayzOrderNo } = require("../utils/orderNo");
const { validateOrderNo, ValidationError } = require("../utils/validator");
const { normalizePayinResponse, normalizeBalanceResponse } = require("../utils/mapper");
const { OPERATIONS, PROVIDER_SUCCESS_CODE, toDbOrderStatus } = require("../constants");
const logger = require("../utils/logger");
const repo = require("../db/repository");

const omitUndefined = (obj) => {
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== null && value !== "") out[key] = value;
  }
  return out;
};

const createPayin = async ({
  amount,
  orderNo: requestedOrderNo,
  purpose,
  paymentMethod,
  expiryPeriod,
  redirectUrl,
  callbackUrl,
  userId,
  requestId,
  correlationId,
}) => {
  const orderNo = requestedOrderNo
    ? validateOrderNo(requestedOrderNo)
    : generateSmilepayzOrderNo("PAY");

  if (!isValidSmilepayzOrderNo(orderNo)) {
    throw new ValidationError("Invalid orderNo", "INVALID_ORDER_NO");
  }

  const merchant = omitUndefined({
    merchantId: config.partnerId,
    merchantName: config.merchantName,
  });

  const payload = omitUndefined({
    orderNo,
    purpose: purpose || "Wallet deposit",
    merchant,
    money: {
      currency: "INR",
      amount,
    },
    paymentMethod: paymentMethod || config.defaultPaymentMethod || undefined,
    expiryPeriod: expiryPeriod || config.expiryPeriod || undefined,
    redirectUrl: redirectUrl || config.returnUrl || undefined,
    callbackUrl: callbackUrl || config.notifyUrl || undefined,
  });

  const result = await postJson({
    path: config.payinEndpoint,
    body: payload,
    operation: OPERATIONS.PAYIN,
    requestId,
    correlationId,
    orderNo,
  });

  const normalized = normalizePayinResponse(result.data, orderNo);
  if (!normalized.success) {
    const err = new Error(normalized.message || "Smilepayz pay-in rejected");
    err.code = "PROVIDER_BUSINESS_ERROR";
    err.provider = result.data;
    throw err;
  }

  logger.event("INFO", "PayIn:createPayin", "transaction_created", {
    requestId,
    correlationId,
    operation: OPERATIONS.PAYIN,
    orderNo,
    providerOrderId: normalized.providerOrderId,
    status: normalized.status,
    message: "Smilepayz pay-in accepted",
  });

  await repo.createPaymentOrder({
    merchant_id: config.partnerId,
    merchant_order_no: orderNo,
    gateway_order_no: normalized.providerOrderId,
    user_id: userId || null,
    order_amount: amount,
    status: toDbOrderStatus(normalized.status),
    pay_url: normalized.paymentUrl,
    deeplink: normalized.deeplink,
    extra: normalized.paymentMethod || null,
    notify_url: payload.callbackUrl || config.notifyUrl || null,
    return_url: payload.redirectUrl || config.returnUrl || null,
    raw_request: payload,
    raw_response: result.data,
    request_id: requestId,
  });

  return {
    ...normalized,
    orderNo,
    usedOrderNo: orderNo,
    providerCode: result.data?.code || PROVIDER_SUCCESS_CODE,
  };
};

const inquiryBalance = async ({
  accountNo,
  balanceTypes = ["BALANCE"],
  requestId,
  correlationId,
}) => {
  const payload = {
    accountNo,
    balanceTypes,
  };

  const result = await postJson({
    path: config.balanceEndpoint,
    body: payload,
    operation: OPERATIONS.BALANCE,
    requestId,
    correlationId,
    retryCount: config.balanceRetryCount,
  });

  const normalized = normalizeBalanceResponse(result.data);
  if (!normalized.success) {
    const err = new Error(normalized.message || "Smilepayz balance inquiry failed");
    err.code = "PROVIDER_BUSINESS_ERROR";
    err.provider = result.data;
    throw err;
  }
  return normalized;
};

module.exports = {
  createPayin,
  inquiryBalance,
};
