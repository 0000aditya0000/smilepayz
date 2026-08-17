const { INTERNAL_STATUS, PAYIN_STATUS_MAP, PAYOUT_STATUS_MAP, FAILED_STATUSES } = require("../constants");
const logger = require("../utils/logger");

const normalizeStatus = (raw) => String(raw || "").trim().toUpperCase();

const mapKnown = (raw, table, operation) => {
  const status = normalizeStatus(raw);
  if (!status) return { internal: INTERNAL_STATUS.PENDING, raw: raw || null, known: false };
  if (table[status]) return { internal: table[status], raw: status, known: true };
  if (FAILED_STATUSES.has(status)) return { internal: INTERNAL_STATUS.FAILED, raw: status, known: true };

  logger.event("WARN", "Mapper", "unknown_status", {
    operation,
    event: "unknown_status",
    providerStatus: status,
    message: `Unmapped Smilepayz status preserved as pending/unknown: ${status}`,
  });
  return { internal: INTERNAL_STATUS.UNKNOWN, raw: status, known: false };
};

const mapSmilepayzPayinStatus = (raw) => mapKnown(raw, PAYIN_STATUS_MAP, "payin");
const mapSmilepayzPayoutStatus = (raw) => mapKnown(raw, PAYOUT_STATUS_MAP, "payout");

const normalizePayinResponse = (provider, orderNo) => {
  const mapped = mapSmilepayzPayinStatus(provider?.status);
  return {
    success: String(provider?.code) === "00",
    status: mapped.internal,
    providerStatus: mapped.raw,
    orderId: provider?.orderNo || orderNo,
    providerOrderId: provider?.tradeNo || null,
    paymentUrl: provider?.channel?.paymentUrl || null,
    message: provider?.message || "",
    code: provider?.code || null,
    rawResponse: provider,
  };
};

const normalizePayoutResponse = (provider, orderNo) => {
  const mapped = mapSmilepayzPayoutStatus(provider?.status);
  return {
    success: String(provider?.code) === "00",
    status: mapped.internal,
    providerStatus: mapped.raw,
    orderId: provider?.orderNo || orderNo,
    providerOrderId: provider?.tradeNo || null,
    utr: provider?.utr || null,
    message: provider?.message || "",
    code: provider?.code || null,
    rawResponse: provider,
  };
};

const normalizeBalanceResponse = (provider) => {
  const infos = Array.isArray(provider?.accountInfos) ? provider.accountInfos : [];
  const first = infos[0] || {};
  return {
    success: String(provider?.code) === "00",
    message: provider?.message || "",
    code: provider?.code || null,
    accountNo: first.accountNo || provider?.accountNo || null,
    name: first.name || provider?.name || null,
    balanceType: first.balanceType || null,
    amount: first.amount?.value ?? first.amount ?? null,
    currency: first.amount?.currency || first.availableBalance?.currency || "INR",
    availableBalance: first.availableBalance?.value ?? first.availableBalance ?? null,
    accountInfos: infos,
    rawResponse: provider,
  };
};

module.exports = {
  mapSmilepayzPayinStatus,
  mapSmilepayzPayoutStatus,
  normalizePayinResponse,
  normalizePayoutResponse,
  normalizeBalanceResponse,
};
