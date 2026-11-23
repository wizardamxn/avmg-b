import { test } from "node:test";
import assert from "node:assert/strict";

process.env.JWT_SECRET ??= "test-secret";
const { newOtp, hashOtp, checkOtp, canResend, OTP_MAX_ATTEMPTS } = await import("../src/lib/otp.js");

const pending = (code, extra = {}) => ({
  emailVerified: false,
  otpHash: hashOtp(code),
  otpExpires: new Date(Date.now() + 60_000),
  otpAttempts: 0,
  ...extra,
});

test("newOtp is always 6 digits", () => {
  for (let i = 0; i < 200; i++) assert.match(newOtp(), /^\d{6}$/);
});

test("checkOtp accepts the right code only", () => {
  assert.equal(checkOtp(pending("042137"), "042137"), "ok");
  assert.equal(checkOtp(pending("042137"), "042138"), "wrong");
});

test("checkOtp refuses expired, locked, verified and missing state", () => {
  assert.equal(checkOtp(pending("111111", { otpExpires: new Date(Date.now() - 1) }), "111111"), "expired");
  assert.equal(checkOtp(pending("111111", { otpAttempts: OTP_MAX_ATTEMPTS }), "111111"), "expired");
  assert.equal(checkOtp(pending("111111", { emailVerified: true }), "111111"), "wrong");
  assert.equal(checkOtp(null, "111111"), "wrong");
});

test("canResend waits 60s between codes", () => {
  assert.equal(canResend({ otpSentAt: null }), true);
  assert.equal(canResend({ otpSentAt: new Date() }), false);
  assert.equal(canResend({ otpSentAt: new Date(Date.now() - 61_000) }), true);
});
