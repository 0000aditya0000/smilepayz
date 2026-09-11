const express = require("express");
const router = express.Router();

const {
  createPayoutHandler,
  getMerchantBalanceHandler,
  payoutWebhookHandler,
} = require("../controllers/payout.controller");
const { requirePayoutSecret } = require("../middleware/requirePayoutSecret");

router.post("/create", requirePayoutSecret, createPayoutHandler);
router.post("/payout", requirePayoutSecret, createPayoutHandler);
router.get("/balance", getMerchantBalanceHandler);
router.post("/balance", getMerchantBalanceHandler);
router.post("/webhook", payoutWebhookHandler);

module.exports = router;
