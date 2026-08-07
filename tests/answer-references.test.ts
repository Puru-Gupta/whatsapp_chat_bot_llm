import test from "node:test";
import assert from "node:assert/strict";
import { addDocumentReference } from "../lib/answer-references";
import { addDataCoverageNotice } from "../lib/data-coverage";

test("adds methodology references", () => {
  const answer = addDocumentReference(
    { text: "AQLI uses long-term PM2.5 exposure.", source: "extractive" },
    "How is AQLI calculated?",
    false
  );
  assert.match(answer, /Reference: AQLI Methodology document\.$/);
});

test("uses the required report missing-data response", () => {
  const answer = addDocumentReference(
    { text: "missing", source: "not_found" },
    "What does the report say about Mars?",
    false
  );
  assert.match(answer, /^I don’t have enough information on that/);
  assert.match(answer, /Reference checked: AQLI Annual Report\.$/);
});

test("adds the state-level coverage notice before the reference", () => {
  const answer = addDataCoverageNotice(
    "India, 2024: 42 µg/m³ PM2.5.\n\nReference: GADM0 CSV."
  );
  assert.match(answer, /Data coverage: Country and state\/province level only/);
  assert.match(answer, /available\.\n\nReference: GADM0 CSV\.$/);
});

test("does not duplicate an existing district coverage explanation", () => {
  const answer = addDataCoverageNotice(
    "District-level data is not currently available. I can answer this at state level.\n\nReference checked: GADM2 CSV."
  );
  assert.equal((answer.match(/District-level data/g) ?? []).length, 1);
});
