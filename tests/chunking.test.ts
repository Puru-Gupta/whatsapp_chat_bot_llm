import test from "node:test";
import assert from "node:assert/strict";
import { csvToKnowledgeText } from "../lib/chunking";

test("converts CSV rows into labeled searchable records", () => {
  const text = csvToKnowledgeText(
    'country,pm25,note\nIndia,46,"Includes Delhi, Mumbai"\nNepal,32,National average',
    "air-quality.csv"
  );

  assert.match(text, /CSV dataset: air-quality\.csv/);
  assert.match(text, /Record 1/);
  assert.match(text, /country: India/);
  assert.match(text, /note: Includes Delhi, Mumbai/);
  assert.match(text, /Record 2/);
  assert.match(text, /country: Nepal/);
});

test("rejects a CSV with headers but no data", () => {
  assert.throws(
    () => csvToKnowledgeText("country,pm25\n", "empty.csv"),
    /no data rows/i
  );
});
