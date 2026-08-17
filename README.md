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

## Logging

Daily files in `logs/smilepayz_logs_YYYY-MM-DD.log`. Events include incoming request, provider request/response, callbacks, signature results, and errors. Private keys and merchant secrets are redacted.

## Status mapping

Documented Smilepayz statuses:

- `SUCCESS` → success
- `PROCESSING` → pending
- `FAIL` / `FAILED` / `FAILURE` → failed
- anything else → unknown/pending (raw status kept, logged)
