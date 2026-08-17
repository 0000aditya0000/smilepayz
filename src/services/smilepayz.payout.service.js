const config = require("../config/smilepayz");
const { postJson } = require("./smilepayz.client");
const { generateSmilepayzOrderNo, isValidSmilepayzOrderNo } = require("../utils/orderNo");
const { validateOrderNo, ValidationError } = require("../utils/validator");
const { normalizePayoutResponse } = require("../utils/mapper");
const { OPERATIONS } = require("../constants");
const logger = require("../utils/logger");

const omitUndefined = (obj) => {
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== null && value !== "") out[key] = value;
  }
  return out;
};

const createPayout = async ({
  amount,
  cashAccount,
  ifscCode,
  receiverName,
  paymentMethod,
  purpose,
  callbackUrl,
  orderNo: requestedOrderNo,
  requestId,
  correlationId,
}) => {
  const orderNo = requestedOrderNo
    ? validateOrderNo(requestedOrderNo)
    : generateSmilepayzOrderNo("POUT");

  if (!isValidSmilepayzOrderNo(orderNo)) {
    throw new ValidationError("Invalid orderNo", "INVALID_ORDER_NO");
  }

  const payload = omitUndefined({
    orderNo,
    purpose: purpose || "Vendor payout",
    merchant: omitUndefined({
      merchantId: config.partnerId,
      merchantName: config.merchantName,
    }),
    money: {
      currency: "INR",
      amount,
    },
    paymentMethod: paymentMethod || config.defaultPayoutPaymentMethod || undefined,
    cashAccount,
    ifscCode,
    receiver: {
      name: receiverName,
    },
    callbackUrl: callbackUrl || config.payoutNotifyUrl || undefined,
  });

  const result = await postJson({
    path: config.payoutEndpoint,
    body: payload,
    operation: OPERATIONS.PAYOUT,
    requestId,
    correlationId,
    orderNo,
  });

  const normalized = normalizePayoutResponse(result.data, orderNo);
  if (!normalized.success) {
    const err = new Error(normalized.message || "Smilepayz pay-out rejected");
    err.code = "PROVIDER_BUSINESS_ERROR";
    err.provider = result.data;
    throw err;
  }

  logger.event("INFO", "Payout:createPayout", "transaction_created", {
    requestId,
    correlationId,
    operation: OPERATIONS.PAYOUT,
    orderNo,
    providerOrderId: normalized.providerOrderId,
    status: normalized.status,
    message: "Smilepayz pay-out accepted",
  });

  return {
    ...normalized,
    orderNo,
    usedMOrderId: orderNo,
    usedOrderNo: orderNo,
  };
};

module.exports = {
  createPayout,
};
