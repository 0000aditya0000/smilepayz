const fs = require("fs");
const path = require("path");
const { GATEWAY } = require("../constants");

const LOG_DIR = path.join(__dirname, "../../logs");

if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

const SENSITIVE_KEY_PATTERN =
  /(private.?key|merchant.?secret|secret|password|authorization|credential|api.?key)/i;

const pad = (n) => String(n).padStart(2, "0");

const timestamp = () => {
  const d = new Date();
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
    `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, "0")}`
  );
};

const logFileName = () => {
  const d = new Date();
  return `smilepayz_logs_${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.log`;
};

const writeToFile = (line) => {
  const filePath = path.join(LOG_DIR, logFileName());
  fs.appendFile(filePath, line + "\n", (err) => {
    if (err) console.error("[Logger] Failed to write log:", err.message);
  });
};

const redactValue = (key, value) => {
  if (value === undefined || value === null) return value;
  if (SENSITIVE_KEY_PATTERN.test(String(key))) return "[REDACTED]";
  if (String(key).toLowerCase() === "x-signature" || String(key).toLowerCase() === "signature") {
    const text = String(value);
    return text.length > 12 ? `${text.slice(0, 8)}…[REDACTED]` : "[REDACTED]";
  }
  return value;
};

const sanitize = (input, depth = 0) => {
  if (input === undefined || input === null) return input;
  if (depth > 6) return "[TRUNCATED]";
  if (Array.isArray(input)) return input.map((item) => sanitize(item, depth + 1));
  if (typeof input !== "object") return input;
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      out[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      out[key] = sanitize(value, depth + 1);
    } else {
      out[key] = redactValue(key, value);
    }
  }
  return out;
};

const format = (level, tag, message, payload) => {
  const header = `[${timestamp()}] [${level.padEnd(5)}] [${tag}] ${message}`;
  if (payload === undefined || payload === null) return header;
  const body = typeof payload === "object" ? JSON.stringify(sanitize(payload), null, 2) : String(payload);
  return `${header}\n${body}`;
};

const write = (level, tag, message, payload) => {
  const line = format(level, tag, message, payload);
  if (level === "ERROR") console.error(line);
  else if (level === "WARN") console.warn(line);
  else console.log(line);
  writeToFile(line);
};

const info = (tag, message, payload) => write("INFO", tag, message, payload);
const warn = (tag, message, payload) => write("WARN", tag, message, payload);
const error = (tag, message, payload) => write("ERROR", tag, message, payload);
const debug = (tag, message, payload) => write("DEBUG", tag, message, payload);

const event = (level, tag, eventName, fields = {}) => {
  const payload = {
    timestamp: new Date().toISOString(),
    level: level.toLowerCase(),
    gateway: GATEWAY,
    event: eventName,
    ...sanitize(fields),
  };
  write(level, tag, fields.message || eventName, payload);
};

const logRequest = (tag, url, payload) => info(tag, `>> OUTGOING REQUEST  ${url}`, payload);
const logResponse = (tag, url, responseData) => info(tag, `<< RESPONSE          ${url}`, responseData);
const logIncoming = (tag, route, payload) => info(tag, `>> INCOMING REQUEST  ${route}`, payload);
const logOutgoing = (tag, route, responseData) => info(tag, `<< OUTGOING RESPONSE ${route}`, responseData);

const logError = (tag, message, err, extra = {}) => {
  const payload = {
    ...extra,
    message: err?.message || message,
    providerResponse: err?.response?.data || null,
    httpStatus: err?.response?.status || null,
    stack: err?.stack || null,
  };
  error(tag, message, payload);
};

const logSign = (tag, _signString, sign) => {
  debug(tag, "SIGNATURE", { sign: redactValue("signature", sign), note: "stringToSign omitted (contains merchant secret)" });
};

const logWebhook = (tag, route, payload) => info(tag, `WEBHOOK RECEIVED     ${route}`, payload);

const logSignVerify = (tag, received, result) => {
  info(tag, `SIGNATURE VERIFY     result=${result ? "VALID" : "INVALID"}`, {
    receivedSign: redactValue("signature", received),
    match: result,
  });
};

const morganStream = {
  write: (message) => {
    writeToFile(`[${timestamp()}] [HTTP ] [ACCESS] ${message.trim()}`);
  },
};

module.exports = {
  info,
  warn,
  error,
  debug,
  event,
  sanitize,
  logRequest,
  logResponse,
  logIncoming,
  logOutgoing,
  logError,
  logSign,
  logWebhook,
  logSignVerify,
  morganStream,
};
