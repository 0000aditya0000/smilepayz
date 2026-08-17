const axios = require("axios");
const config = require("../config/smilepayz");
const { buildSmilepayzHeaders } = require("./smilepayz.signature");
const logger = require("../utils/logger");
const { EVENTS } = require("../constants");
const repo = require("../db/repository");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const classifyError = (err) => {
  const code = err?.code || "";
  if (code === "ECONNABORTED" || code === "ETIMEDOUT" || /timeout/i.test(err?.message || "")) {
    return "timeout";
  }
  if (["ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "ECONNREFUSED"].includes(code)) {
    return "network_error";
  }
  if (err?.response) return "provider_error";
  return "unexpected_error";
};

const postJson = async ({
  path,
  body,
  operation,
  requestId,
  correlationId,
  orderNo,
  timeout = config.requestTimeoutMs,
  retryCount = 0,
}) => {
  if (!config.partnerId) {
    throw new Error("Smilepayz partner ID is not configured");
  }

  const { timestamp, minifiedBody, headers } = buildSmilepayzHeaders({
    body,
    partnerId: config.partnerId,
  });
  const url = `${config.baseURL}${path}`;
  const started = Date.now();

  logger.event("INFO", "SmilepayzClient", EVENTS.PROVIDER_REQUEST, {
    requestId,
    correlationId,
    operation,
    orderNo,
    url,
    method: "POST",
    partnerId: config.partnerId,
    timestamp,
    headers: {
      "Content-Type": headers["Content-Type"],
      "X-TIMESTAMP": headers["X-TIMESTAMP"],
      "X-PARTNER-ID": headers["X-PARTNER-ID"],
      "X-SIGNATURE": headers["X-SIGNATURE"],
    },
    body,
    message: `Smilepayz ${operation} request sent`,
  });

  await repo.createRequestLog({
    request_id: requestId,
    correlation_id: correlationId,
    merchant_id: config.partnerId,
    order_no: orderNo,
    direction: "out",
    method: "POST",
    path,
    request_payload: body,
    headers: {
      "Content-Type": headers["Content-Type"],
      "X-TIMESTAMP": headers["X-TIMESTAMP"],
      "X-PARTNER-ID": headers["X-PARTNER-ID"],
    },
  });
  await repo.createGatewayLog({
    request_id: requestId,
    correlation_id: correlationId,
    merchant_id: config.partnerId,
    order_no: orderNo,
    direction: "out",
    method: "POST",
    path,
    status: "sent",
    request_payload: body,
  });

  let attempt = 0;
  let lastError;

  while (attempt <= retryCount) {
    try {
      const response = await axios.post(url, minifiedBody, {
        headers,
        timeout,
        transformRequest: [(data) => data],
        validateStatus: () => true,
      });
      const duration = Date.now() - started;
      const data = response.data;

      logger.event("INFO", "SmilepayzClient", EVENTS.PROVIDER_RESPONSE, {
        requestId,
        correlationId,
        operation,
        orderNo,
        httpStatus: response.status,
        providerCode: data?.code,
        providerMessage: data?.message,
        providerTradeNo: data?.tradeNo,
        providerOrderNo: data?.orderNo,
        providerStatus: data?.status,
        duration,
        body: data,
        message: `Smilepayz ${operation} response received`,
      });

      await repo.createResponseLog({
        request_id: requestId,
        correlation_id: correlationId,
        merchant_id: config.partnerId,
        order_no: orderNo,
        direction: "in",
        method: "POST",
        path,
        http_status: response.status,
        gateway_status: data?.status || data?.code,
        execution_ms: duration,
        retry_count: attempt,
        response_payload: data,
      });
      await repo.createGatewayLog({
        request_id: requestId,
        correlation_id: correlationId,
        merchant_id: config.partnerId,
        order_no: orderNo,
        direction: "in",
        method: "POST",
        path,
        status: "received",
        http_status: response.status,
        gateway_status: data?.status || data?.code,
        execution_ms: duration,
        retry_count: attempt,
        response_payload: data,
      });

      if (typeof data !== "object" || data === null) {
        const err = new Error("Malformed Smilepayz response");
        err.code = "MALFORMED_PROVIDER_RESPONSE";
        err.response = { status: response.status, data };
        throw err;
      }

      return { data, httpStatus: response.status, duration, timestamp };
    } catch (err) {
      lastError = err;
      const kind = classifyError(err);
      logger.event("ERROR", "SmilepayzClient", kind === "timeout" ? EVENTS.TIMEOUT : kind === "network_error" ? EVENTS.NETWORK_ERROR : EVENTS.PROVIDER_ERROR, {
        requestId,
        correlationId,
        operation,
        orderNo,
        endpoint: url,
        errorName: err.name,
        errorMessage: err.message,
        httpStatus: err.response?.status,
        providerResponse: err.response?.data,
        duration: Date.now() - started,
        attempt,
        message: `Smilepayz ${operation} ${kind}`,
      });

      if (attempt < retryCount && (kind === "timeout" || kind === "network_error")) {
        attempt += 1;
        await repo.createRetryLog({
          request_id: requestId,
          path,
          attempt,
          error_code: err.code || kind,
          error_message: err.message,
          payload: { operation, orderNo },
        });
        await sleep(300 * 2 ** attempt);
        continue;
      }
      throw err;
    }
  }

  throw lastError;
};

module.exports = {
  postJson,
  classifyError,
};
