const test = require("node:test");
const assert = require("node:assert/strict");
const { checkUrl, checkMessage, checkEmail, registrableDomain } = require("../public/js/checks.js");

const titles = (r) => r.findings.map((f) => f.title).join(" | ");

test("registrableDomain handles common and country second-level domains", () => {
  assert.equal(registrableDomain("www.example.com"), "example.com");
  assert.equal(registrableDomain("a.b.amazon.co.uk"), "amazon.co.uk");
  assert.equal(registrableDomain("example.com"), "example.com");
});

test("official sites are low risk", () => {
  for (const u of ["https://www.paypal.com/signin", "https://google.com", "https://www.amazon.in/", "https://github.com/"]) {
    const r = checkUrl(u);
    assert.equal(r.level, "low", `${u}: ${titles(r)}`);
  }
});

test("brand impersonation and lookalikes are high risk", () => {
  assert.equal(checkUrl("http://paypal-secure-login.xyz/verify").level, "high");
  assert.match(titles(checkUrl("https://paypa1.com/login")), /Lookalike/);
  assert.equal(checkUrl("https://paypa1.com/login").level, "high");
  assert.match(titles(checkUrl("https://amazom.com")), /Misspelling/);
  assert.match(titles(checkUrl("https://apple-id-support.com")), /apple/);
  assert.equal(checkUrl("http://sbi-kyc-update.top/login").level, "high");
  assert.equal(checkUrl("https://www.onlinesbi.sbi/").level, "low");
  assert.equal(checkUrl("https://www.hdfcbank.com/").level, "low");
});

test("does not flag words that merely contain a short brand name", () => {
  assert.doesNotMatch(titles(checkUrl("https://pineapple.com")), /apple/);
  assert.doesNotMatch(titles(checkUrl("https://groups.io")), /ups/);
});

test("structural URL tricks are detected", () => {
  assert.match(titles(checkUrl("http://192.168.1.10/login")), /IP address/);
  assert.match(titles(checkUrl("https://xn--pypal-4ve.com")), /punycode/);
  assert.match(titles(checkUrl("https://google.com@evil.example/")), /@/);
  assert.match(titles(checkUrl("https://bit.ly/abc")), /Shortened/);
  assert.match(titles(checkUrl("https://example.com/app.apk")), /program/);
});

test("invalid URL input returns an error", () => {
  assert.ok(checkUrl("").error);
  assert.ok(checkUrl("not a url at all").error);
});

test("scam messages are high risk", () => {
  const r = checkMessage("Dear customer, your account will be BLOCKED. Verify your account immediately at http://sbi-kyc.top/login and share the OTP.");
  assert.equal(r.level, "high");
  assert.match(titles(r), /OTP/);
  assert.match(titles(r), /Suspicious link/);
  assert.deepEqual(r.links, ["http://sbi-kyc.top/login"]);
});

test("ordinary messages are low risk", () => {
  for (const m of [
    "Hey, are we still on for dinner at 7? I'll bring dessert.",
    "Your OTP for login is 482910. Do not share it with anyone.",
  ]) {
    const r = checkMessage(m);
    assert.equal(r.level, "low", `${m}: ${titles(r)}`);
  }
});

test("login pages on official domains are not flagged as suspicious", () => {
  assert.equal(checkUrl("https://www.flipkart.com/account/login").level, "low");
});

test("email checks", () => {
  assert.equal(checkEmail("paypal.security@gmail.com").level, "high");
  assert.equal(checkEmail("someone@mailinator.com").level, "medium");
  assert.equal(checkEmail("billing@amaz0n-support.com").level, "high");
  assert.equal(checkEmail("Jane <jane.doe@gmail.com>").level, "low");
  assert.equal(checkEmail("service@paypal.com").level, "low");
  assert.ok(checkEmail("nope").error);
});
