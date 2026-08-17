const dns = require("dns");
const https = require("https");
const axios = require("axios");
const config = require("../config/smilepayz");
const { buildSmilepayzHeaders } = require("./smilepayz.signature");
const logger = require("../utils/logger");
const { EVENTS } = require("../constants");
const repo = require("../db/repository");

/**
 * IPv4-only agent for Smilepayz provider calls.
 * Scoped to this client so other apps/gateways keep using IPv6 normally.
 */
const ipv4HttpsAgent = new https.Agent({
  keepAlive: true,
  family: 4,
  lookup: (hostname, _options, callback) => {
    dns.lookup(hostname, { family: 4, all: false }, callback);
  },
});

const providerAxios = axios.create({
  httpsAgent: ipv4HttpsAgent,
});

const IPV4_CONNECT_FAILED = "Smilepayz IPv4 connection failed";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isIpv4Mapped = (address) => String(address || "").startsWith("::ffff:");

const isIpv6Address = (address) => {
  const value = String(address || "");
  if (!value || isIpv4Mapped(value)) return false;
  return value.includes(":");
};

const getSocketInfo = (response) => {
  const socket = response?.request?.socket || response?.request?.connection || null;
  const remoteAddress = socket?.remoteAddress || null;
  const remoteFamily = socket?.remoteFamily || null;
  return {
    remoteAddress,
    remoteFamily,
    networkFamily: "IPv4",
  };
};

const assertIpv4Socket = (socketInfo) => {
  if (socketInfo.remoteFamily === "IPv6" || isIpv6Address(socketInfo.remoteAddress)) {
    const err = new Error(IPV4_CONNECT_FAILED);
    err.code = "ERR_SMILEPAYZ_IPV6_BLOCKED";
    err.remoteAddress = socketInfo.remoteAddress;
    err.remoteFamily = socketInfo.remoteFamily;
    throw err;
  }
};

const classifyError = (err) => {
  const code = err?.code || "";
  if (code === "ECONNABORTED" || code === "ETIMEDOUT" || /timeout/i.test(err?.message || "")) {
    return "timeout";
  }
  if (
    [
      "ECONNRESET",
      "ENOTFOUND",
      "EAI_AGAIN",
      "ECONNREFUSED",
      "ENETUNREACH",
      "EHOSTUNREACH",
      "EAI_ADDRFAMILY",
      "ERR_SMILEPAYZ_IPV6_BLOCKED",
    ].includes(code)
  ) {
    return "network_error";
  }
  if (err?.response) return "provider_error";
  return "unexpected_error";
};

const toIpv4Error = (err, kind) => {
  if (kind !== "network_error" && kind !== "timeout") return err;
  if (String(err?.message || "").startsWith(IPV4_CONNECT_FAILED)) return err;
  const wrapped = new Error(`${IPV4_CONNECT_FAILED}: ${err.message}`);
  wrapped.code = err.code;
  wrapped.cause = err;
  wrapped.response = err.response;
  return wrapped;
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
    networkFamily: "IPv4",
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
      const response = await providerAxios.post(url, minifiedBody, {
        headers,
        timeout,
        httpsAgent: ipv4HttpsAgent,
        transformRequest: [(data) => data],
        validateStatus: () => true,
      });
      const duration = Date.now() - started;
      const data = response.data;
      const socketInfo = getSocketInfo(response);
      assertIpv4Socket(socketInfo);

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
        networkFamily: socketInfo.networkFamily,
        remoteAddress: socketInfo.remoteAddress,
        remoteFamily: socketInfo.remoteFamily,
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

      return { data, httpStatus: response.status, duration, timestamp, socketInfo };
    } catch (err) {
      lastError = err;
      const kind = classifyError(err);
      const ipv4Err = toIpv4Error(err, kind);
      logger.event("ERROR", "SmilepayzClient", kind === "timeout" ? EVENTS.TIMEOUT : kind === "network_error" ? EVENTS.NETWORK_ERROR : EVENTS.PROVIDER_ERROR, {
        requestId,
        correlationId,
        operation,
        orderNo,
        endpoint: url,
        errorName: ipv4Err.name,
        errorMessage: ipv4Err.message,
        httpStatus: ipv4Err.response?.status,
        providerResponse: ipv4Err.response?.data,
        duration: Date.now() - started,
        attempt,
        networkFamily: "IPv4",
        remoteAddress: err.remoteAddress || null,
        message: kind === "network_error" || kind === "timeout" ? IPV4_CONNECT_FAILED : `Smilepayz ${operation} ${kind}`,
      });

      if (attempt < retryCount && (kind === "timeout" || kind === "network_error")) {
        attempt += 1;
        await repo.createRetryLog({
          request_id: requestId,
          path,
          attempt,
          error_code: ipv4Err.code || kind,
          error_message: ipv4Err.message,
          payload: { operation, orderNo },
        });
        await sleep(300 * 2 ** attempt);
        continue;
      }
      throw ipv4Err;
    }
  }

  throw lastError;
};

module.exports = {
  postJson,
  classifyError,
  ipv4HttpsAgent,
  getSocketInfo,
  isIpv6Address,
  IPV4_CONNECT_FAILED,
};
