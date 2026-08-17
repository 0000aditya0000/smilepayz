const express = require("express");
const router = express.Router();

const {
  createPaymentHandler,
  getBalanceHandler,
} = require("../controllers/payment.controller");
const {
  createPayoutHandler,
  getMerchantBalanceHandler,
} = require("../controllers/payout.controller");
const { createOrderRateLimiter } = require("../middlewares/rateLimiter");

router.post("/payin", createOrderRateLimiter(), createPaymentHandler);
router.post("/payout", createPayoutHandler);
router.post("/balance", getBalanceHandler);
router.get("/balance", getMerchantBalanceHandler);

module.exports = router;
