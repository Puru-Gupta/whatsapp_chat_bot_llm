import test from "node:test";
import assert from "node:assert/strict";
import { isPrivateAddress, normalizeWebsiteUrl } from "../lib/website";

test("normalizes a bare hostname to HTTPS", () => {
  assert.equal(
    normalizeWebsiteUrl("aqli.epic.uchicago.edu/about"),
    "https://aqli.epic.uchicago.edu/about"
  );
});

test("blocks private and loopback addresses", () => {
  assert.equal(isPrivateAddress("127.0.0.1"), true);
  assert.equal(isPrivateAddress("10.20.30.40"), true);
  assert.equal(isPrivateAddress("192.168.1.5"), true);
  assert.equal(isPrivateAddress("::1"), true);
});

test("allows public addresses", () => {
  assert.equal(isPrivateAddress("8.8.8.8"), false);
  assert.equal(isPrivateAddress("2606:4700:4700::1111"), false);
});
