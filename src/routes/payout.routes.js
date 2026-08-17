const express = require("express");
const router = express.Router();

const {
  createPayoutHandler,
  getMerchantBalanceHandler,
  payoutWebhookHandler,
} = require("../controllers/payout.controller");

router.post("/create", createPayoutHandler);
router.post("/payout", createPayoutHandler);
router.get("/balance", getMerchantBalanceHandler);
router.post("/balance", getMerchantBalanceHandler);
router.post("/webhook", payoutWebhookHandler);

module.exports = router;
