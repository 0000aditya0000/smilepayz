require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const paymentRoutes = require("./routes/payment.routes");
const payoutRoutes = require("./routes/payout.routes");
const gatewayRoutes = require("./routes/gateway.routes");
const { webhookHandler } = require("./controllers/payment.controller");
const { payoutWebhookHandler } = require("./controllers/payout.controller");
const { requestIdMiddleware } = require("./middlewares/requestId");
const { requestLogger } = require("./middlewares/requestLogger");
const logger = require("./utils/logger");
const { ValidationError } = require("./utils/validator");
const { syncGatewayTables } = require("./db/sync");
const config = require("./config/smilepayz");

const app = express();

const allowedOrigins = String(process.env.ALLOWED_ORIGINS || "*")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

app.set("trust proxy", 1);
app.use(
  helmet({
    crossOriginResourcePolicy: false,
  })
);
app.use(
  cors({
    origin: allowedOrigins.includes("*") ? true : allowedOrigins,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-TIMESTAMP",
      "X-SIGNATURE",
      "X-PARTNER-ID",
      "X-Request-Id",
      "X-Correlation-Id",
    ],
  })
);
app.use(morgan("combined", { stream: logger.morganStream }));
app.use(morgan("dev"));
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(requestIdMiddleware);
app.use(requestLogger);

app.post("/api/payment/webhook", webhookHandler);
app.post("/api/payout/webhook", payoutWebhookHandler);
app.post("/api/gateway/smilepayz/callback/payin", webhookHandler);
app.post("/api/gateway/smilepayz/callback/payout", payoutWebhookHandler);

app.use("/api/payments", paymentRoutes);
app.use("/api/payout", payoutRoutes);
app.use("/api/gateway/smilepayz", gatewayRoutes);

app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    service: "smilepayz-gateway",
    env: process.env.SMILEPAYZ_ENV || "sandbox",
    publicBaseUrl: config.publicBaseUrl,
  });
});

app.get("/", (req, res) => {
  res.json({
    message: "Smilepayz Payment Gateway API",
    version: "1.0.0",
    endpoints: {
      createUserOrder: "POST /api/payments/user/order",
      createPayment: "POST /api/payments/create",
      payin: "POST /api/payments/payin",
      payinBalance: "POST /api/payments/balance",
      payinWebhook: "POST /api/payment/webhook",
      createPayout: "POST /api/payout/create",
      merchantBalance: "GET /api/payout/balance",
      payoutWebhook: "POST /api/payout/webhook",
      health: "GET /health",
    },
    smilepayzEndpoints: {
      payin: "POST /v2.0/transaction/pay-in",
      payout: "POST /v2.0/disbursement/pay-out",
      balance: "POST /v2.0/inquiry-balance",
    },
  });
});

app.use((req, res) => {
  res.status(404).json({ success: false, error: "Route not found" });
});

app.use((err, req, res, next) => {
  logger.logError("App:GlobalErrorHandler", "Unhandled error", err, {
    requestId: req.requestId,
    correlationId: req.correlationId,
  });
  const status = err instanceof ValidationError ? err.statusCode : 500;
  res.status(status).json({
    success: false,
    error: status === 500 ? "Internal server error" : err.message,
    message: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
});

const PORT = process.env.PORT || 3000;
const shouldSyncTables = process.env.DB_SYNC_LOG_TABLES !== "false";

if (require.main === module) {
  (async () => {
    try {
      if (shouldSyncTables) {
        await syncGatewayTables();
      }
      app.listen(PORT, () => {
        logger.info("App", `Smilepayz Gateway Server running on port ${PORT}`);
        logger.info("App", `Public URL: ${config.publicBaseUrl}`);
        logger.info("App", `PayIn  API: ${config.publicBaseUrl}/api/payments`);
        logger.info("App", `Payout API: ${config.publicBaseUrl}/api/payout`);
        logger.info("App", `Health:     ${config.publicBaseUrl}/health`);
      });
    } catch (err) {
      logger.logError("App", "Failed to start Smilepayz gateway", err);
      process.exit(1);
    }
  })();
}

module.exports = app;
