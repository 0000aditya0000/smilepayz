const { createRequestId, createCorrelationId } = require("../utils/requestId");

const requestIdMiddleware = (req, res, next) => {
  const incoming = req.headers["x-request-id"] || req.headers["x-correlation-id"];
  req.requestId = createRequestId();
  req.correlationId = createCorrelationId(incoming);
  res.setHeader("X-Request-Id", req.requestId);
  res.setHeader("X-Correlation-Id", req.correlationId);
  next();
};

module.exports = { requestIdMiddleware };
