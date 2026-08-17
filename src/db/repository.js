const db = require("../config/database");
const logger = require("../utils/logger");

const json = (value) => {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch (_) {
    return null;
  }
};

const safe = async (label, fn) => {
  try {
    return await fn();
  } catch (err) {
    logger.warn("SmilepayzRepo", `${label} skipped`, { error: err.message });
    return null;
  }
};

const createPaymentOrder = (data) =>
  safe("createPaymentOrder", () =>
    db.execute(
      `INSERT INTO smilepayz_payment_orders (
        merchant_id, merchant_order_no, gateway_order_no, user_id, order_amount, status,
        pay_url, deeplink, notify_url, return_url, extra, utr, raw_request, raw_response, request_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        gateway_order_no = VALUES(gateway_order_no),
        status = VALUES(status),
        pay_url = VALUES(pay_url),
        deeplink = VALUES(deeplink),
        raw_response = VALUES(raw_response),
        request_id = VALUES(request_id)`,
      [
        data.merchant_id,
        data.merchant_order_no,
        data.gateway_order_no || null,
        data.user_id || null,
        data.order_amount,
        data.status ?? 0,
        data.pay_url || null,
        json(data.deeplink),
        data.notify_url || null,
        data.return_url || null,
        data.extra || null,
        data.utr || null,
        json(data.raw_request),
        json(data.raw_response),
        data.request_id || null,
      ]
    )
  );

const updatePaymentOrder = (merchantOrderNo, values) =>
  safe("updatePaymentOrder", async () => {
    const fields = [];
    const params = [];
    const map = {
      gateway_order_no: values.gateway_order_no,
      status: values.status,
      pay_url: values.pay_url,
      utr: values.utr,
      raw_response: values.raw_response != null ? json(values.raw_response) : undefined,
      paid_at: values.paid_at,
    };
    for (const [key, value] of Object.entries(map)) {
      if (value !== undefined) {
        fields.push(`${key} = ?`);
        params.push(value);
      }
    }
    if (!fields.length) return;
    params.push(merchantOrderNo);
    await db.execute(
      `UPDATE smilepayz_payment_orders SET ${fields.join(", ")} WHERE merchant_order_no = ?`,
      params
    );
  });

const createPayoutOrder = (data) =>
  safe("createPayoutOrder", () =>
    db.execute(
      `INSERT INTO smilepayz_payout_orders (
        merchant_id, merchant_order_no, gateway_order_no, withdraw_id, order_amount,
        account_name, card_number, ifsc, status, notify_url, utr, raw_request, raw_response, request_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        gateway_order_no = VALUES(gateway_order_no),
        status = VALUES(status),
        utr = VALUES(utr),
        raw_response = VALUES(raw_response),
        request_id = VALUES(request_id)`,
      [
        data.merchant_id,
        data.merchant_order_no,
        data.gateway_order_no || null,
        data.withdraw_id || null,
        data.order_amount,
        data.account_name || null,
        data.card_number || null,
        data.ifsc || null,
        data.status ?? 0,
        data.notify_url || null,
        data.utr || null,
        json(data.raw_request),
        json(data.raw_response),
        data.request_id || null,
      ]
    )
  );

const updatePayoutOrder = (merchantOrderNo, values) =>
  safe("updatePayoutOrder", async () => {
    const fields = [];
    const params = [];
    const map = {
      gateway_order_no: values.gateway_order_no,
      status: values.status,
      utr: values.utr,
      raw_response: values.raw_response != null ? json(values.raw_response) : undefined,
      paid_at: values.paid_at,
    };
    for (const [key, value] of Object.entries(map)) {
      if (value !== undefined) {
        fields.push(`${key} = ?`);
        params.push(value);
      }
    }
    if (!fields.length) return;
    params.push(merchantOrderNo);
    await db.execute(
      `UPDATE smilepayz_payout_orders SET ${fields.join(", ")} WHERE merchant_order_no = ?`,
      params
    );
  });

const insertLog = (table, data) =>
  safe(table, () =>
    db.execute(
      `INSERT INTO ${table} (
        request_id, correlation_id, merchant_id, order_no, direction, method, path,
        status, gateway_status, http_status, execution_ms, retry_count, headers,
        request_payload, response_payload, raw_payload, error_message, stack_trace, ip
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.request_id || null,
        data.correlation_id || null,
        data.merchant_id || null,
        data.order_no || null,
        data.direction || null,
        data.method || null,
        data.path || null,
        data.status || null,
        data.gateway_status || null,
        data.http_status || null,
        data.execution_ms || null,
        data.retry_count || 0,
        json(data.headers),
        json(data.request_payload),
        json(data.response_payload),
        json(data.raw_payload),
        data.error_message || null,
        data.stack_trace || null,
        data.ip || null,
      ]
    )
  );

const createGatewayLog = (data) => insertLog("smilepayz_gateway_logs", data);
const createRequestLog = (data) => insertLog("smilepayz_request_logs", data);
const createResponseLog = (data) => insertLog("smilepayz_response_logs", data);

const createWebhookLog = (data) =>
  safe("createWebhookLog", () =>
    db.execute(
      `INSERT INTO smilepayz_webhook_logs (
        request_id, correlation_id, merchant_id, order_no, direction, method, path,
        status, gateway_status, http_status, request_payload, raw_payload,
        error_message, signature_valid, processed, ip
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.request_id || null,
        data.correlation_id || null,
        data.merchant_id || null,
        data.order_no || null,
        data.direction || "in",
        data.method || "POST",
        data.path || null,
        data.status || null,
        data.gateway_status || null,
        data.http_status || null,
        json(data.request_payload),
        json(data.raw_payload),
        data.error_message || null,
        data.signature_valid == null ? null : data.signature_valid ? 1 : 0,
        data.processed ? 1 : 0,
        data.ip || null,
      ]
    )
  );

const findPayoutOrder = (orderNo, tradeNo) =>
  safe("findPayoutOrder", async () => {
    const [rows] = await db.execute(
      `SELECT id, withdraw_id, merchant_order_no, gateway_order_no, order_amount, status
       FROM smilepayz_payout_orders
       WHERE merchant_order_no = ? OR gateway_order_no = ?
       LIMIT 1`,
      [orderNo || "", tradeNo || ""]
    );
    return rows[0] || null;
  });

const createRetryLog = (data) =>
  safe("createRetryLog", () =>
    db.execute(
      `INSERT INTO smilepayz_retry_logs (request_id, path, attempt, error_code, error_message, payload)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        data.request_id || null,
        data.path || null,
        data.attempt,
        data.error_code || null,
        data.error_message || null,
        json(data.payload),
      ]
    )
  );

module.exports = {
  createPaymentOrder,
  updatePaymentOrder,
  createPayoutOrder,
  updatePayoutOrder,
  findPayoutOrder,
  createGatewayLog,
  createRequestLog,
  createResponseLog,
  createWebhookLog,
  createRetryLog,
};
