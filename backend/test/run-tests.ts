import assert from "node:assert/strict";
import crypto from "node:crypto";
import { validateInitData } from "../src/services/telegramAuth.js";
import { isValidGameId } from "../src/utils/validators.js";

const buildInitData = (botToken: string, authDate: number) => {
  const payload = {
    auth_date: String(authDate),
    query_id: "AAE1_TEST_QUERY",
    user: JSON.stringify({ id: 12345, username: "tester" }),
  };
  const dataCheckString = Object.entries(payload)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");
  const params = new URLSearchParams({ ...payload, hash });
  return params.toString();
};

const run = () => {
  assert.equal(isValidGameId("12345"), true);
  assert.equal(isValidGameId("1234"), false);
  assert.equal(isValidGameId("12345678901234567"), false);
  assert.equal(isValidGameId("1234a"), false);

  const token = "test-token";
  const now = Math.floor(Date.now() / 1000);
  const validInit = buildInitData(token, now);
  assert.equal(validateInitData(validInit, token), true);

  const expiredInit = buildInitData(token, now - 10);
  assert.equal(validateInitData(expiredInit, token, 1), false);

  const futureInit = buildInitData(token, now + 10);
  assert.equal(validateInitData(futureInit, token), false);
};

run();
console.log("All tests passed.");
