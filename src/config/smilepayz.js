require("dotenv").config();
const fs = require("fs");

const SANDBOX_BASE_URL = "https://sandbox-gateway.smilepayz.com";
const PRODUCTION_BASE_URL = "https://gateway.smilepayz.com";

const envName = String(process.env.SMILEPAYZ_ENV || "sandbox").trim().toLowerCase();
const isProduction = envName === "production" || envName === "prod";
const activeEnv = isProduction ? "production" : "sandbox";

const pick = (...values) => {
  for (const value of values) {
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
};

const defaultBaseUrl = isProduction ? PRODUCTION_BASE_URL : SANDBOX_BASE_URL;

const readKeyFile = (filePath) => {
  const resolved = pick(filePath);
  if (!resolved) return "";
  try {
    if (fs.existsSync(resolved)) {
      return fs.readFileSync(resolved, "utf8");
    }
  } catch (_) {
    // File is only present on the VPS; signing will fail later with a clear error.
  }
  return "";
};

const privateKeyPath = pick(
  isProduction ? process.env.SMILEPAYZ_PRODUCTION_PRIVATE_KEY_PATH : process.env.SMILEPAYZ_SANDBOX_PRIVATE_KEY_PATH,
  process.env.SMILEPAYZ_PRIVATE_KEY_PATH
);
const merchantPublicKeyPath = pick(process.env.SMILEPAYZ_PUBLIC_KEY_PATH);

module.exports = {
  env: activeEnv,
  isProduction,
  sandboxBaseUrl: SANDBOX_BASE_URL,
  productionBaseUrl: PRODUCTION_BASE_URL,
  baseURL: pick(process.env.SMILEPAYZ_BASE_URL) || defaultBaseUrl,
  partnerId: pick(
    isProduction ? process.env.SMILEPAYZ_PRODUCTION_PARTNER_ID : process.env.SMILEPAYZ_SANDBOX_PARTNER_ID,
    process.env.SMILEPAYZ_PARTNER_ID
  ),
  merchantSecret: pick(
    isProduction ? process.env.SMILEPAYZ_PRODUCTION_MERCHANT_SECRET : process.env.SMILEPAYZ_SANDBOX_MERCHANT_SECRET,
    process.env.SMILEPAYZ_MERCHANT_SECRET
  ),
  privateKeyPath,
  merchantPublicKeyPath,
  privateKey: pick(
    readKeyFile(privateKeyPath),
    isProduction ? process.env.SMILEPAYZ_PRODUCTION_PRIVATE_KEY : process.env.SMILEPAYZ_SANDBOX_PRIVATE_KEY,
    process.env.SMILEPAYZ_PRIVATE_KEY
  ),
  platformPublicKey: pick(
    isProduction ? process.env.SMILEPAYZ_PRODUCTION_PLATFORM_PUBLIC_KEY : process.env.SMILEPAYZ_SANDBOX_PLATFORM_PUBLIC_KEY,
    process.env.SMILEPAYZ_PLATFORM_PUBLIC_KEY
  ),
  merchantName: pick(process.env.SMILEPAYZ_MERCHANT_NAME),
  accountNo: pick(process.env.SMILEPAYZ_ACCOUNT_NO),
  payinAccountNo: pick(process.env.SMILEPAYZ_PAYIN_ACCOUNT_NO, process.env.SMILEPAYZ_ACCOUNT_NO),
  payoutAccountNo: pick(process.env.SMILEPAYZ_PAYOUT_ACCOUNT_NO, process.env.SMILEPAYZ_ACCOUNT_NO),
  defaultPaymentMethod: pick(process.env.SMILEPAYZ_PAYMENT_METHOD) || "CASHIER_IN",
  defaultPayoutPaymentMethod: pick(process.env.SMILEPAYZ_PAYOUT_PAYMENT_METHOD),
  expiryPeriod: Number(process.env.SMILEPAYZ_EXPIRY_PERIOD || 3600),
  payinEndpoint: "/v2.0/transaction/pay-in",
  payoutEndpoint: "/v2.0/disbursement/pay-out",
  balanceEndpoint: "/v2.0/inquiry-balance",
  publicBaseUrl: pick(process.env.APP_BASE_URL) || "https://smilepayz.rollix777.com",
  notifyUrl: pick(process.env.NOTIFY_URL) || "https://smilepayz.rollix777.com/api/payment/webhook",
  payoutNotifyUrl: pick(process.env.PAYOUT_NOTIFY_URL) || "https://smilepayz.rollix777.com/api/payout/webhook",
  returnUrl: pick(process.env.RETURN_URL) || "https://r7dream.com/",
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS || 15000),
  balanceRetryCount: Number(process.env.BALANCE_RETRY_COUNT || 1),
  currency: "INR",
  timeZone: "Asia/Kolkata",
};
