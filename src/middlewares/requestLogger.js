const logger = require("../utils/logger");
const { EVENTS } = require("../constants");

const requestLogger = (req, res, next) => {
  if (req.path === "/health") return next();
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
  next();
};

module.exports = { requestLogger };
