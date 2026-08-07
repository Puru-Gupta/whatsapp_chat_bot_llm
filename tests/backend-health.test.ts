import test from "node:test";
import assert from "node:assert/strict";
import { isBackendUnreachable } from "../lib/backend-health";

test("detects a paused project's DNS failure", () => {
  // Shape logged by supabase-js when the project hostname stops resolving.
  const error = {
    message: "TypeError: fetch failed",
    details:
      "TypeError: fetch failed\n\nCaused by: Error: getaddrinfo ENOTFOUND svzdejbqrfuwpywpjhzz.supabase.co (ENOTFOUND)",
    hint: "",
    code: "",
  };

  assert.equal(isBackendUnreachable(error), true);
});

test("detects a resuming project's Cloudflare 521", () => {
  // Origin is still down while Cloudflare already serves the hostname, so the
  // failure arrives as a structured 5xx body with no network error string.
  const error = {
    title: "Error 521: Web server is down",
    status: 521,
    error_name: "origin_down",
    zone: "svzdejbqrfuwpywpjhzz.supabase.co",
    retryable: true,
  };

  assert.equal(isBackendUnreachable(error), true);
});

test("treats ordinary Postgres errors as data errors, not outages", () => {
  const uniqueViolation = {
    code: "23505",
    message: "duplicate key value violates unique constraint",
    details: null,
    hint: null,
  };
  const rlsDenial = {
    code: "42501",
    message: "new row violates row-level security policy",
    details: null,
    hint: null,
  };

  assert.equal(isBackendUnreachable(uniqueViolation), false);
  assert.equal(isBackendUnreachable(rlsDenial), false);
});

test("ignores absent errors", () => {
  assert.equal(isBackendUnreachable(null), false);
  assert.equal(isBackendUnreachable(undefined), false);
});

test("detects thrown network errors from the retrieval path", () => {
  const thrown = new Error("fetch failed");
  assert.equal(isBackendUnreachable(thrown), true);
});
