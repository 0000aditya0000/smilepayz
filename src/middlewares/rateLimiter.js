const rateLimit = require("express-rate-limit");
const logger = require("../utils/logger");

const getUserRateLimitKey = (req) => {
  const userId = req.body?.userId;
  if (userId !== undefined && userId !== null && String(userId).trim() !== "") {
    return `user:${String(userId).trim()}`;
  }
  return null;
};

const createRechargeRateLimiter = () =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    keyGenerator: (req) => getUserRateLimitKey(req) || "user:anonymous",
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      logger.warn("Rate limit exceeded for recharge endpoint", {
        user_id: req.body?.userId,
        ip: req.ip,
        path: req.path,
      });
      res.status(429).json({
        success: false,
        error: "Too many recharge attempts. Please try again later.",
        retryAfter: "15 minutes",
      });
    },
  });

const createOrderRateLimiter = () =>
  rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 3,
    keyGenerator: (req) => getUserRateLimitKey(req) || "user:anonymous",
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      logger.warn("Rate limit exceeded for order creation", {
        user_id: req.body?.userId,
        ip: req.ip,
        path: req.path,
      });
      res.status(429).json({
        success: false,
        error: "Too many order creation attempts. Please try again later.",
        retryAfter: "5 minutes",
      });
    },
  });

module.exports = {
  createRechargeRateLimiter,
  createOrderRateLimiter,
};
