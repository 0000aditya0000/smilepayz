const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

const {
  generateSmilepayzOrderNo,
  isValidSmilepayzOrderNo,
} = require("../src/utils/orderNo");
const {
  toIntegerAmount,
  validateOrderNo,
  validateIfsc,
  validateAccountNumber,
  validatePayoutRequest,
  validatePayinRequest,
  validateUserOrderRequest,
  ValidationError,
} = require("../src/utils/validator");
const {
  mapSmilepayzPayinStatus,
  mapSmilepayzPayoutStatus,
  normalizePayinResponse,
  normalizeBalanceResponse,
} = require("../src/utils/mapper");
const {
  minifyJson,
  signRequestBody,
  verifySmilepayzCallbackSignature,
  getXTimestamp,
} = require("../src/services/smilepayz.signature");
const { classifyError } = require("../src/services/smilepayz.client");
const { INTERNAL_STATUS } = require("../src/constants");

const makeKeyPair = () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  return {
    privateKeyBase64: privateKey.export({ type: "pkcs8", format: "der" }).toString("base64"),
    publicKeyBase64: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
    privateKey,
    publicKey,
  };
};

describe("orderNo", () => {
  test("generates valid alphanumeric order numbers", () => {
    for (let i = 0; i < 20; i += 1) {
      const orderNo = generateSmilepayzOrderNo("PAY");
      assert.equal(isValidSmilepayzOrderNo(orderNo), true);
      assert.match(orderNo, /^[A-Za-z0-9]{6,32}$/);
      assert.equal(/[-_\s]/.test(orderNo), false);
    }
  });

  test("rejects invalid order numbers", () => {
    assert.equal(isValidSmilepayzOrderNo("PAY_2026"), false);
    assert.equal(isValidSmilepayzOrderNo("PAY-1"), false);
    assert.equal(isValidSmilepayzOrderNo("abc"), false);
    assert.throws(() => validateOrderNo("PAY_1"), ValidationError);
  });
});

describe("validator", () => {
  test("accepts integer amount and rejects decimals", () => {
    assert.equal(toIntegerAmount(100), 100);
    assert.throws(() => toIntegerAmount(100.5), ValidationError);
    assert.throws(() => toIntegerAmount(0), ValidationError);
    assert.throws(() => toIntegerAmount("abc"), ValidationError);
  });

  test("validates IFSC and account", () => {
    assert.equal(validateIfsc("HDFC0001234"), "HDFC0001234");
    assert.throws(() => validateIfsc("HDFC"), ValidationError);
    assert.throws(() => validateIfsc("hdfc0001234x"), ValidationError);
    assert.equal(validateAccountNumber("123456789012"), "123456789012");
    assert.throws(() => validateAccountNumber(""), ValidationError);
  });

  test("validates payin and payout payloads", () => {
    const payin = validatePayinRequest({ amount: 500, orderNo: "PAY202608171234AB" });
    assert.equal(payin.amount, 500);
    const userOrder = validateUserOrderRequest({ amount: 100, userId: 12345 });
    assert.equal(userOrder.amount, 100);
    assert.equal(userOrder.userId, "12345");
    assert.match(userOrder.user_mobile, /^\d{10}$/);
    assert.equal(userOrder.recharge_type, "smilepayz");
    assert.throws(() => validateUserOrderRequest({ amount: 100 }), ValidationError);
    const payout = validatePayoutRequest({
      withdrawId: 99,
      amount: 200,
      bankNo: "123456789012",
      ifsc: "HDFC0001234",
      name: "Rajesh Kumar",
    });
    assert.equal(payout.ifscCode, "HDFC0001234");
    assert.throws(() => validatePayoutRequest({ amount: 200 }), ValidationError);
  });
});

describe("status mapper", () => {
  test("maps known payin/payout statuses", () => {
    assert.equal(mapSmilepayzPayinStatus("SUCCESS").internal, INTERNAL_STATUS.SUCCESS);
    assert.equal(mapSmilepayzPayinStatus("PROCESSING").internal, INTERNAL_STATUS.PENDING);
    assert.equal(mapSmilepayzPayinStatus("FAILED").internal, INTERNAL_STATUS.FAILED);
    assert.equal(mapSmilepayzPayinStatus("SOMETHING_NEW").internal, INTERNAL_STATUS.UNKNOWN);
    assert.equal(mapSmilepayzPayoutStatus("SUCCESS").internal, INTERNAL_STATUS.SUCCESS);
  });

  test("normalizes provider responses", () => {
    const payin = normalizePayinResponse({
      code: "00",
      message: "Successful",
      orderNo: "PAY1",
      tradeNo: "T1",
      status: "PROCESSING",
      channel: { paymentUrl: "https://example.com/pay" },
    }, "PAY1");
    assert.equal(payin.success, true);
    assert.equal(payin.paymentUrl, "https://example.com/pay");
    assert.equal(payin.providerOrderId, "T1");

    const balance = normalizeBalanceResponse({
      code: "00",
      message: "ok",
      accountInfos: [
        {
          accountNo: "ACC1",
          amount: { currency: "INR", value: "100.00" },
          availableBalance: { currency: "INR", value: "90.00" },
        },
      ],
    });
    assert.equal(balance.success, true);
    assert.equal(balance.availableBalance, "90.00");
  });
});

describe("signature", () => {
  test("minifies JSON without changing field values", () => {
    const body = { orderNo: "PAY1", money: { amount: 100, currency: "INR" } };
    const minified = minifyJson(body);
    assert.equal(minified.includes(" "), false);
    assert.equal(JSON.parse(minified).money.amount, 100);
  });

  test("request sign and callback verify use different formulas", () => {
    const keys = makeKeyPair();
    const timestamp = getXTimestamp();
    const minifiedBody = minifyJson({ orderNo: "PAYTEST123456", money: { amount: 100, currency: "INR" } });
    const requestSig = signRequestBody({
      timestamp,
      minifiedBody,
      merchantSecret: "test-secret",
      privateKeyMaterial: keys.privateKeyBase64,
    });
    assert.equal(typeof requestSig, "string");
    assert.ok(requestSig.length > 20);

    const tradeNo = "121200012412131607559245";
    const signer = crypto.createSign("RSA-SHA256");
    signer.update(`${tradeNo}|${timestamp}`, "utf8");
    const callbackSig = signer.sign(keys.privateKey, "base64");

    const ok = verifySmilepayzCallbackSignature({
      tradeNo,
      timestamp,
      signature: callbackSig,
      platformPublicKey: keys.publicKeyBase64,
    });
    assert.equal(ok.verified, true);

    const bad = verifySmilepayzCallbackSignature({
      tradeNo,
      timestamp,
      signature: requestSig,
      platformPublicKey: keys.publicKeyBase64,
    });
    assert.equal(bad.verified, false);

    const missingKey = verifySmilepayzCallbackSignature({
      tradeNo,
      timestamp,
      signature: callbackSig,
      platformPublicKey: "",
    });
    assert.equal(missingKey.verified, false);
    assert.equal(missingKey.reason, "platform_public_key_not_configured");

    const missingSig = verifySmilepayzCallbackSignature({
      tradeNo,
      timestamp,
      signature: "",
      platformPublicKey: keys.publicKeyBase64,
    });
    assert.equal(missingSig.verified, false);
  });

  test("rejects invalid private key", () => {
    assert.throws(() =>
      signRequestBody({
        timestamp: getXTimestamp(),
        minifiedBody: "{}",
        merchantSecret: "x",
        privateKeyMaterial: "not-a-key",
      })
    );
  });
});

describe("client errors", () => {
  test("classifies timeout and network errors", () => {
    assert.equal(classifyError({ code: "ECONNABORTED", message: "timeout" }), "timeout");
    assert.equal(classifyError({ code: "ENOTFOUND" }), "network_error");
    assert.equal(classifyError({ response: { status: 500 } }), "provider_error");
  });
});
