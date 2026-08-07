import test from "node:test";
import assert from "node:assert/strict";
import {
  inferCsvDatasetLevel,
  selectLatestCsvSources,
} from "../lib/csv-sources";

test("identifies GADM levels from changing filenames and column structure", () => {
  assert.equal(
    inferCsvDatasetLevel({ filePath: "gadm2_aqli_2027.csv" }),
    "gadm2"
  );
  assert.equal(
    inferCsvDatasetLevel({ columns: ["country", "name_1", "pm2024"] }),
    "gadm1"
  );
  assert.equal(
    inferCsvDatasetLevel({ columns: ["name0", "year", "pm25"] }),
    "gadm0"
  );
});

test("keeps only the newest uploaded source for each GADM level", () => {
  const selected = selectLatestCsvSources([
    { id: "old", file_path: "gadm1_2025.csv", updated_at: "2025-01-01" },
    { id: "new", file_path: "state_gadm1_latest.csv", updated_at: "2026-01-01" },
    { id: "country", file_path: "gadm0_2026.csv", updated_at: "2026-01-01" },
  ]);
  assert.deepEqual(
    selected.map((source) => source.id).sort(),
    ["country", "new"]
  );
});
