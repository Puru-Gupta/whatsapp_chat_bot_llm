#!/usr/bin/env node
/**
 * Run Supabase schema migration via the Management API.
 *
 * Usage:
 *   SUPABASE_PROJECT_REF=your-project-ref SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/migrate.mjs
 *
 * Get your personal access token from:
 *   https://supabase.com/dashboard/account/tokens
 */

import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF;
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!PROJECT_REF) {
  console.error("SUPABASE_PROJECT_REF is not set.");
  console.error("    Find it in your Supabase project URL or project settings.");
  process.exit(1);
}

if (!TOKEN) {
  console.error("SUPABASE_ACCESS_TOKEN is not set.");
  console.error(
    "    Get one from: https://supabase.com/dashboard/account/tokens"
  );
  console.error(
    "    Then run: SUPABASE_PROJECT_REF=your-project-ref SUPABASE_ACCESS_TOKEN=sbp_xxx node scripts/migrate.mjs"
  );
  process.exit(1);
}

const schemaPath = resolve(__dirname, "../supabase/schema.sql");
const sql = readFileSync(schemaPath, "utf-8");

const statements = splitSqlStatements(sql);

console.log(`Running ${statements.length} SQL statements on project ${PROJECT_REF}...\n`);

let success = 0;
let failed = 0;

for (const statement of statements) {
  const query = statement.endsWith(";") ? statement : statement + ";";

  try {
    const res = await fetch(
      `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query }),
      }
    );

    const data = await res.json();

    if (!res.ok) {
      // Ignore "already exists" errors — safe to re-run
      const msg = data?.message ?? JSON.stringify(data);
      if (
        msg.includes("already exists") ||
        msg.includes("duplicate") ||
        msg.includes("IF NOT EXISTS")
      ) {
        console.log(`  ok (already exists) ${query.slice(0, 60)}...`);
        success++;
      } else {
        console.error(`  FAILED: ${query.slice(0, 80)}...`);
        console.error(`    Error: ${msg}`);
        failed++;
      }
    } else {
      console.log(`  ok ${query.slice(0, 60)}${query.length > 60 ? "..." : ""}`);
      success++;
    }
  } catch (err) {
    console.error(`  Network error: ${err.message}`);
    failed++;
  }
}

console.log(`\nDone: ${success} succeeded, ${failed} failed.`);

if (failed === 0) {
  console.log("\nSupabase schema is ready. Now run: npm run deploy");
}

function splitSqlStatements(input) {
  const statements = [];
  let current = "";
  let dollarQuote = null;
  let inSingleQuote = false;
  let inLineComment = false;

  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    const next = input[i + 1];

    if (inLineComment) {
      current += char;
      if (char === "\n") inLineComment = false;
      continue;
    }

    if (!inSingleQuote && !dollarQuote && char === "-" && next === "-") {
      inLineComment = true;
      current += char;
      continue;
    }

    if (!dollarQuote && char === "'" && input[i - 1] !== "\\") {
      inSingleQuote = !inSingleQuote;
      current += char;
      continue;
    }

    if (!inSingleQuote && char === "$") {
      const match = input.slice(i).match(/^\$[A-Za-z0-9_]*\$/);
      if (match) {
        const tag = match[0];
        if (!dollarQuote) {
          dollarQuote = tag;
        } else if (dollarQuote === tag) {
          dollarQuote = null;
        }
        current += tag;
        i += tag.length - 1;
        continue;
      }
    }

    if (!inSingleQuote && !dollarQuote && char === ";") {
      const statement = stripSqlComments(current).trim();
      if (statement) statements.push(statement);
      current = "";
      continue;
    }

    current += char;
  }

  const trailing = stripSqlComments(current).trim();
  if (trailing) statements.push(trailing);

  return statements;
}

function stripSqlComments(statement) {
  return statement
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}
