const crypto = require("crypto");
const logger = require("../utils/logger");
const config = require("../config/smilepayz");

const CALLBACK_FORMULA = "tradeNo|X-TIMESTAMP verified with Platform Public Key (SHA256withRSA)";
const REQUEST_FORMULA = "X-TIMESTAMP|merchant_secret|minify(body) signed with merchant private key (SHA256withRSA)";

const normalizeKeyMaterial = (raw) => String(raw || "").trim().replace(/\\n/g, "\n");

const loadPrivateKey = (raw) => {
  const material = normalizeKeyMaterial(raw);
  if (!material) {
    throw new Error("Smilepayz private key is not configured");
  }
  if (material.includes("BEGIN")) {
    return crypto.createPrivateKey(material);
  }
  return crypto.createPrivateKey({
    key: Buffer.from(material.replace(/\s/g, ""), "base64"),
    format: "der",
    type: "pkcs8",
  });
};

const loadPublicKey = (raw) => {
  const material = normalizeKeyMaterial(raw);
  if (!material) {
    throw new Error("Smilepayz platform public key is not configured");
  }
  if (material.includes("BEGIN")) {
    return crypto.createPublicKey(material);
  }
  return crypto.createPublicKey({
    key: Buffer.from(material.replace(/\s/g, ""), "base64"),
    format: "der",
    type: "spki",
  });
};

const minifyJson = (body) => {
  if (typeof body === "string") {
    return JSON.stringify(JSON.parse(body));
  }
  return JSON.stringify(body);
};

const getXTimestamp = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: config.timeZone || "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}+05:30`;
};

const signRequestBody = ({ timestamp, minifiedBody, merchantSecret, privateKeyMaterial }) => {
  if (!merchantSecret) {
    throw new Error("Smilepayz merchant secret is not configured");
  }
  const stringToSign = `${timestamp}|${merchantSecret}|${minifiedBody}`;
  const privateKey = loadPrivateKey(privateKeyMaterial || config.privateKey);
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(stringToSign, "utf8");
  const signature = signer.sign(privateKey, "base64");
  logger.logSign("Smilepayz:signRequestBody", null, signature);
  return signature;
};

const buildSmilepayzHeaders = ({ body, timestamp, partnerId }) => {
  const ts = timestamp || getXTimestamp();
  const minifiedBody = minifyJson(body);
  const signature = signRequestBody({
    timestamp: ts,
    minifiedBody,
    merchantSecret: config.merchantSecret,
    privateKeyMaterial: config.privateKey,
  });
  return {
    timestamp: ts,
    minifiedBody,
    headers: {
      "Content-Type": "application/json",
      "X-TIMESTAMP": ts,
      "X-SIGNATURE": signature,
      "X-PARTNER-ID": partnerId || config.partnerId,
    },
  };
};

/**
 * Callback signature != request signature.
 * Formula from Smilepayz Callback Signature docs:
 *   stringToSign = tradeNo + "|" + X-TIMESTAMP
 *   verify SHA256withRSA using Platform Public Key
 */
const verifySmilepayzCallbackSignature = ({
  tradeNo,
  timestamp,
  signature,
  platformPublicKey,
}) => {
  if (!tradeNo || !timestamp || !signature) {
    return {
      verified: false,
      reason: "missing_callback_signature_inputs",
      formula: CALLBACK_FORMULA,
    };
  }

  const keyMaterial = platformPublicKey || config.platformPublicKey;
  if (!keyMaterial) {
    logger.error(
      "Smilepayz:verifyCallbackSignature",
      "Callback verification cannot be performed: SMILEPAYZ_PLATFORM_PUBLIC_KEY is not configured. Failing closed."
    );
    return {
      verified: false,
      reason: "platform_public_key_not_configured",
      formula: CALLBACK_FORMULA,
    };
  }

  try {
    const stringToSign = `${tradeNo}|${timestamp}`;
    const publicKey = loadPublicKey(keyMaterial);
    const verifier = crypto.createVerify("RSA-SHA256");
    verifier.update(stringToSign, "utf8");
    const verified = verifier.verify(publicKey, signature, "base64");
    return {
      verified,
      reason: verified ? "ok" : "signature_mismatch",
      formula: CALLBACK_FORMULA,
    };
  } catch (err) {
    logger.logError("Smilepayz:verifyCallbackSignature", "Callback signature verification error", err);
    return {
      verified: false,
      reason: err.message || "verification_error",
      formula: CALLBACK_FORMULA,
    };
  }
};

module.exports = {
  minifyJson,
  getXTimestamp,
  signRequestBody,
  buildSmilepayzHeaders,
  verifySmilepayzCallbackSignature,
  loadPrivateKey,
  loadPublicKey,
  CALLBACK_FORMULA,
  REQUEST_FORMULA,
};
