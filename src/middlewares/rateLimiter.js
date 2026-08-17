const rateLimit = require("express-rate-limit");
const logger = require("../utils/logger");

/**
 * Build a per-user rate limit key from request body.
 * Uses userId so users on the same network/IP are limited independently.
 */
const getUserRateLimitKey = (req) => {
  const userId = req.body?.userId;
  if (userId !== undefined && userId !== null && String(userId).trim() !== "") {
    return `user:${String(userId).trim()}`;
  }
  return null;
};

/**
 * Recharge endpoint limiter (Skillpay-compatible).
 * 5 requests per userId per 15 minutes.
 */
const createRechargeRateLimiter = () =>
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 5,
    keyGenerator: (req) => getUserRateLimitKey(req) || "user:anonymous",
    validate: { keyGeneratorIpFallback: false },
    message: {
      success: false,
      error: "Too many recharge attempts. Please try again later.",
      retryAfter: "15 minutes",
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      logger.warn("RateLimiter", "Rate limit exceeded for recharge endpoint", {
        user_id: req.body?.userId,
        ip: req.ip,
        user_agent: req.get("user-agent"),
        path: req.path,
        body: req.body,
      });
      res.status(429).json({
        success: false,
        error: "Too many recharge attempts. Please try again later.",
        retryAfter: "15 minutes",
      });
    },
  });

/**
 * Order creation limiter (Skillpay-compatible).
 * 3 requests per userId per 5 minutes.
 */
const createOrderRateLimiter = () =>
  rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 3,
    keyGenerator: (req) => getUserRateLimitKey(req) || "user:anonymous",
    validate: { keyGeneratorIpFallback: false },
    message: {
      success: false,
      error: "Too many order creation attempts. Please try again later.",
      retryAfter: "5 minutes",
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
      logger.warn("RateLimiter", "Rate limit exceeded for order creation", {
        user_id: req.body?.userId,
        ip: req.ip,
        user_agent: req.get("user-agent"),
        path: req.path,
        body: req.body,
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
