const crypto = require("crypto");

const createRequestId = () => crypto.randomBytes(12).toString("hex");

const createCorrelationId = (seed) => {
  if (seed && String(seed).trim()) return String(seed).trim().slice(0, 64);
  return createRequestId();
};

module.exports = {
  createRequestId,
  createCorrelationId,
};
