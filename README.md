# Smilepayz Payment Gateway (Node.js)

Isolated Smilepayz integration for ROLLIX777, modelled on `Gateway/GATEWAYSKILLPAY` (Skillpay/Silkpay) routes, recharge/withdrawl DB updates, and logging — with Smilepayz-specific RSA signing and callbacks from the official v2.0 docs.

This service does **not** change Skillpay.

## Provider APIs

| Operation | Method | Path |
|-----------|--------|------|
| Pay-in | POST | `/v2.0/transaction/pay-in` |
| Pay-out | POST | `/v2.0/disbursement/pay-out` |
| Balance | POST | `/v2.0/inquiry-balance` |

Base URL is selected by `SMILEPAYZ_ENV`:

- sandbox: `https://sandbox-gateway.smilepayz.com`
- production: `https://gateway.smilepayz.com`

Public app base URL: `https://smilepayz.rollix777.com`

## Local API (Skillpay-compatible)

| Local route | Purpose |
|-------------|---------|
| `POST /api/payments/user/order` | App pay-in (inserts `recharge`, returns `{ paymentUrl }`) |
| `POST /api/payments/create` | Direct pay-in |
| `POST /api/payment/webhook` | Pay-in callback (responds `SUCCESS`) |
| `POST /api/payout/create` | Payout (`withdrawId`, `amount`, `bankNo`, `ifsc`, `name`) |
| `GET /api/payout/balance` | Merchant balance |
| `POST /api/payout/webhook` | Payout callback (responds `SUCCESS`) |
| `GET /health` | Health |

Aliases:

- `POST /api/gateway/smilepayz/payin`
- `POST /api/gateway/smilepayz/payout`
- `POST /api/gateway/smilepayz/balance`
- `POST /api/gateway/smilepayz/callback/payin`
- `POST /api/gateway/smilepayz/callback/payout`

## Signatures

**Outbound request (not used for callbacks):**

```text
stringToSign = X-TIMESTAMP + "|" + merchant_secret + "|" + minify(body)
X-SIGNATURE  = Base64(SHA256withRSA(stringToSign, merchantPrivateKey))
```

Headers: `Content-Type`, `X-TIMESTAMP`, `X-SIGNATURE`, `X-PARTNER-ID`

**Callback (different formula):**

```text
stringToSign = tradeNo + "|" + X-TIMESTAMP
verify with Platform Public Key
```

If the platform public key is missing, verification **fails closed** and the transaction is not updated.

After a valid processed callback the HTTP body is exactly:

```text
SUCCESS
```

## Setup

```bash
cd Gateway/smilepayz
cp .env.example .env
npm install
npm test
npm run dev
```

Configure RSA keys and Merchant Secret from the Smilepayz Merchant Portal. Never commit private keys.

## Database tables

On startup the gateway creates the same table set as Aeropay, prefixed `smilepayz_` (instead of `aeropay_`):

| Table | Purpose |
|-------|---------|
| `smilepayz_gateway_logs` | Gateway operation logs |
| `smilepayz_merchants` | Merchant / partner config |
| `smilepayz_payment_orders` | Pay-in orders |
| `smilepayz_payout_orders` | Pay-out orders |
| `smilepayz_refunds` | Refunds |
| `smilepayz_request_logs` | Outbound/inbound request payloads |
| `smilepayz_response_logs` | Provider and HTTP responses |
| `smilepayz_retry_logs` | Retry attempts |
| `smilepayz_settlements` | Settlements |
| `smilepayz_webhook_logs` | Pay-in / pay-out callbacks |

Platform tables `recharge` and `withdrawl` are still used. Disable auto-create with `DB_SYNC_LOG_TABLES=false`. SQL is also in `sql/smilepayz_tables.sql` for phpMyAdmin.

## Rate limits (Skillpay-compatible)

| Endpoint | Limit |
|----------|--------|
| `POST /api/payments/user/order` | 5 requests / user / 15 minutes |
| `POST /api/payments/create` and `/payin` | 3 requests / user / 5 minutes |

Keyed by `userId` so users on the same IP are limited independently.

## Logging

Daily files in `logs/smilepayz_logs_YYYY-MM-DD.log`. Events include incoming request, provider request/response, callbacks, signature results, and errors. Private keys and merchant secrets are redacted.

## Status mapping

Documented Smilepayz statuses:

- `SUCCESS` → success
- `PROCESSING` → pending
- `FAIL` / `FAILED` / `FAILURE` → failed
- anything else → unknown/pending (raw status kept, logged)
