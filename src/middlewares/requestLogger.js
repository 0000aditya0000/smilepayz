const logger = require("../utils/logger");
const { EVENTS } = require("../constants");
const repo = require("../db/repository");

const requestLogger = (req, res, next) => {
  if (req.path === "/health") return next();
  const started = Date.now();
  logger.event("INFO", "HTTP", EVENTS.INCOMING_REQUEST, {
    requestId: req.requestId,
    correlationId: req.correlationId,
    method: req.method,
    route: req.originalUrl,
    clientIp: req.ip,
    headers: req.headers,
    body: req.body,
    message: "Incoming API request",
  });

  repo.createRequestLog({
    request_id: req.requestId,
    correlation_id: req.correlationId,
    order_no: req.body?.orderNo || req.body?.orderId || null,
    direction: "in",
    method: req.method,
    path: req.originalUrl,
    request_payload: req.body,
    ip: req.ip,
  });

  res.on("finish", () => {
    repo.createResponseLog({
      request_id: req.requestId,
      correlation_id: req.correlationId,
      order_no: req.body?.orderNo || req.body?.orderId || null,
      direction: "out",
      method: req.method,
      path: req.originalUrl,
      http_status: res.statusCode,
      execution_ms: Date.now() - started,
      ip: req.ip,
    });
  });

  next();
};

module.exports = { requestLogger };
