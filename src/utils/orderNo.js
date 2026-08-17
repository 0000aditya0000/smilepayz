const crypto = require("crypto");

const ALPHANUMERIC = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const ORDER_NO_REGEX = /^[A-Za-z0-9]{6,32}$/;

const randomAlphanumeric = (length) => {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += ALPHANUMERIC[bytes[i] % ALPHANUMERIC.length];
  }
  return out;
};

const pad = (n, size = 2) => String(n).padStart(size, "0");

/**
 * Smilepayz orderNo rules:
 * 6-32 chars, A-Z a-z 0-9 only, no spaces/hyphens/underscores/unicode.
 * Pattern: [PREFIX][TIMESTAMP][RANDOM] e.g. PAY202608172212ABC123
 */
const generateSmilepayzOrderNo = (prefix = "PAY") => {
  const safePrefix = String(prefix || "PAY").replace(/[^A-Za-z0-9]/g, "").slice(0, 6) || "PAY";
  const now = new Date();
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}` +
    `${pad(now.getMilliseconds(), 3)}`;
  const random = randomAlphanumeric(6);
  let orderNo = `${safePrefix}${stamp}${random}`.slice(0, 32);
  if (orderNo.length < 6) {
    orderNo = `${orderNo}${randomAlphanumeric(6)}`.slice(0, 32);
  }
  if (!ORDER_NO_REGEX.test(orderNo)) {
    throw new Error("Generated Smilepayz orderNo failed validation");
  }
  return orderNo;
};

const isValidSmilepayzOrderNo = (orderNo) => ORDER_NO_REGEX.test(String(orderNo || ""));

module.exports = {
  generateSmilepayzOrderNo,
  isValidSmilepayzOrderNo,
  ORDER_NO_REGEX,
};
