const GATEWAY = "smilepayz";

const OPERATIONS = {
  PAYIN: "payin",
  PAYOUT: "payout",
  BALANCE: "balance",
  CALLBACK_PAYIN: "callback_payin",
  CALLBACK_PAYOUT: "callback_payout",
};

const EVENTS = {
  INCOMING_REQUEST: "incoming_request",
  PROVIDER_REQUEST: "provider_request",
  PROVIDER_RESPONSE: "provider_response",
  CALLBACK_RECEIVED: "callback_received",
  CALLBACK_SIGNATURE_VERIFIED: "callback_signature_verified",
  CALLBACK_SIGNATURE_FAILED: "callback_signature_failed",
  CALLBACK_REJECTED: "callback_rejected",
  CALLBACK_PROCESSED: "callback_processed",
  CALLBACK_DUPLICATE: "callback_duplicate",
  TRANSACTION_CREATED: "transaction_created",
  TRANSACTION_STATUS_UPDATED: "transaction_status_updated",
  VALIDATION_FAILED: "validation_failed",
  PROVIDER_ERROR: "provider_error",
  NETWORK_ERROR: "network_error",
  TIMEOUT: "timeout",
  UNEXPECTED_ERROR: "unexpected_error",
  SIGNATURE_GENERATED: "signature_generated",
  UNKNOWN_STATUS: "unknown_status",
};

const PROVIDER_SUCCESS_CODE = "00";

const INTERNAL_STATUS = {
  PENDING: "pending",
  SUCCESS: "success",
  FAILED: "failed",
  UNKNOWN: "unknown",
};

const PAYIN_STATUS_MAP = {
  SUCCESS: INTERNAL_STATUS.SUCCESS,
  PROCESSING: INTERNAL_STATUS.PENDING,
};

const PAYOUT_STATUS_MAP = {
  SUCCESS: INTERNAL_STATUS.SUCCESS,
  PROCESSING: INTERNAL_STATUS.PENDING,
};

const FAILED_STATUSES = new Set(["FAIL", "FAILED", "FAILURE"]);

module.exports = {
  GATEWAY,
  OPERATIONS,
  EVENTS,
  PROVIDER_SUCCESS_CODE,
  INTERNAL_STATUS,
  PAYIN_STATUS_MAP,
  PAYOUT_STATUS_MAP,
  FAILED_STATUSES,
};
