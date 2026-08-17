const { isValidSmilepayzOrderNo } = require("../utils/orderNo");

class ValidationError extends Error {
  constructor(message, code = "VALIDATION_ERROR") {
    super(message);
    this.name = "ValidationError";
    this.code = code;
    this.statusCode = 400;
  }
}

const toIntegerAmount = (amount) => {
  if (amount === undefined || amount === null || amount === "") {
    throw new ValidationError("Missing required field: amount", "INVALID_AMOUNT");
  }
  const numeric = Number(amount);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new ValidationError("Invalid amount", "INVALID_AMOUNT");
  }
  if (!Number.isInteger(numeric)) {
    throw new ValidationError("Smilepayz amount must be an integer; decimals are rejected", "INVALID_AMOUNT");
  }
  return numeric;
};

const validateOrderNo = (orderNo) => {
  if (!isValidSmilepayzOrderNo(orderNo)) {
    throw new ValidationError(
      "Invalid orderNo: must be 6-32 alphanumeric characters with no spaces, hyphens, or special characters",
      "INVALID_ORDER_NO"
    );
  }
  return String(orderNo);
};

const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;

const validateIfsc = (ifsc) => {
  const value = String(ifsc || "").trim().toUpperCase();
  if (value.length !== 11 || !IFSC_REGEX.test(value)) {
    throw new ValidationError("Invalid IFSC: must be 11 characters (e.g. HDFC0001234)", "INVALID_IFSC");
  }
  return value;
};

const validateAccountNumber = (accountNo) => {
  const value = String(accountNo || "").trim();
  if (!value || value.length > 32 || !/^[A-Za-z0-9]+$/.test(value)) {
    throw new ValidationError("Invalid bank account number", "INVALID_ACCOUNT");
  }
  return value;
};

const validateReceiverName = (name) => {
  const value = String(name || "").trim();
  if (!value) {
    throw new ValidationError("Missing required field: receiver name", "INVALID_RECEIVER");
  }
  return value;
};

const randomTenDigitMobile = () =>
  String(Math.floor(1000000000 + Math.random() * 9000000000));

const validatePayinRequest = (body = {}) => {
  const amount = toIntegerAmount(body.amount);
  const orderNo = body.orderNo || body.orderId || body.mOrderId || null;
  if (orderNo) validateOrderNo(orderNo);
  return {
    amount,
    orderNo,
    userId: body.userId,
    user_mobile: body.user_mobile,
    recharge_type: body.recharge_type,
    payment_mode: body.payment_mode,
    purpose: body.purpose,
    paymentMethod: body.paymentMethod,
    expiryPeriod: body.expiryPeriod,
    redirectUrl: body.redirectUrl || body.returnUrl,
    callbackUrl: body.callbackUrl || body.notifyUrl,
  };
};

/** App deposit: frontend sends only amount + userId. Backend fills the rest. */
const validateUserOrderRequest = (body = {}) => {
  const userId = body.userId;
  if (userId === undefined || userId === null || String(userId).trim() === "") {
    throw new ValidationError("Missing required field: userId", "MISSING_USER_ID");
  }
  return {
    amount: toIntegerAmount(body.amount),
    userId: String(userId).trim(),
    user_mobile: randomTenDigitMobile(),
    recharge_type: "smilepayz",
    payment_mode: "smilepayz",
    purpose: "Wallet deposit",
  };
};

const validatePayoutRequest = (body = {}) => {
  const withdrawId = body.withdrawId || body.withdrawalId;
  if (!withdrawId) {
    throw new ValidationError("Missing required field: withdrawId", "MISSING_WITHDRAW_ID");
  }
  return {
    withdrawId,
    amount: toIntegerAmount(body.amount),
    cashAccount: validateAccountNumber(body.cashAccount || body.bankNo || body.accountNumber),
    ifscCode: validateIfsc(body.ifsc || body.ifscCode || body.ifsCode),
    receiverName: validateReceiverName(body.name || body.receiverName || body.receiver?.name),
    paymentMethod: body.paymentMethod,
    purpose: body.purpose,
    callbackUrl: body.callbackUrl || body.notifyUrl,
    orderNo: body.orderNo || body.mOrderId || null,
  };
};

const validateBalanceRequest = (body = {}, fallbackAccountNo = "") => {
  const accountNo = String(body.accountNo || fallbackAccountNo || "").trim();
  if (!accountNo) {
    throw new ValidationError("Missing required field: accountNo", "INVALID_ACCOUNT");
  }
  return {
    accountNo,
    balanceTypes: Array.isArray(body.balanceTypes) && body.balanceTypes.length
      ? body.balanceTypes
      : ["BALANCE"],
  };
};

module.exports = {
  ValidationError,
  toIntegerAmount,
  validateOrderNo,
  validateIfsc,
  validateAccountNumber,
  validateReceiverName,
  randomTenDigitMobile,
  validatePayinRequest,
  validateUserOrderRequest,
  validatePayoutRequest,
  validateBalanceRequest,
};
