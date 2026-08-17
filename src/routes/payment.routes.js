const express = require("express");
const router = express.Router();

const {
  createPaymentHandler,
  createUserOrderHandler,
  getBalanceHandler,
  webhookHandler,
} = require("../controllers/payment.controller");

const { createRechargeRateLimiter, createOrderRateLimiter } = require("../middlewares/rateLimiter");
const { validateUserStatus } = require("../middlewares/userStatusValidator");

router.post("/user/order", createRechargeRateLimiter(), validateUserStatus, createUserOrderHandler);
router.post("/create", createOrderRateLimiter(), createPaymentHandler);
router.post("/payin", createOrderRateLimiter(), createPaymentHandler);
router.post("/balance", getBalanceHandler);
router.post("/webhook", webhookHandler);

module.exports = router;
