import { parse } from "csv-parse/sync";

/**
 * Text chunking utility.
 * Splits text into overlapping chunks of ~800-1200 tokens.
 * Uses character-based approximation: ~4 chars per token.
 */

const CHUNK_SIZE = 1000; // target tokens
const CHUNK_OVERLAP = 150; // overlap tokens
const CHARS_PER_TOKEN = 4;
const MAX_CSV_ROWS = 10_000;
const CSV_BATCH_CHARACTERS = 12_000;

export interface CsvKnowledgeBatch {
  text: string;
  metadata: {
    file_format: "csv";
    filename: string;
    csv_columns: string[];
    csv_records: Array<Record<string, string>>;
  };
}

export function chunkText(text: string): string[] {
  const cleaned = cleanText(text);
  const chunkCharSize = CHUNK_SIZE * CHARS_PER_TOKEN;
  const overlapChars = CHUNK_OVERLAP * CHARS_PER_TOKEN;

  const chunks: string[] = [];

  // Split by paragraphs first to preserve meaning
  const paragraphs = cleaned.split(/\n{2,}/);
  let currentChunk = "";

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;

    // If paragraph itself exceeds chunk size, split it by sentences
    if (trimmed.length > chunkCharSize) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = currentChunk.slice(-overlapChars);
      }
      const sentences = splitBySentences(trimmed);
      for (const sentence of sentences) {
        if ((currentChunk + " " + sentence).length > chunkCharSize) {
          if (currentChunk) {
            chunks.push(currentChunk.trim());
            currentChunk = currentChunk.slice(-overlapChars);
          }
        }
        currentChunk += (currentChunk ? " " : "") + sentence;
      }
      continue;
    }

    if ((currentChunk + "\n\n" + trimmed).length > chunkCharSize) {
      if (currentChunk) {
        chunks.push(currentChunk.trim());
        currentChunk = currentChunk.slice(-overlapChars);
      }
    }

    currentChunk += (currentChunk ? "\n\n" : "") + trimmed;
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks.filter((c) => c.length > 50); // skip tiny fragments
}

function splitBySentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function cleanText(text: string): string {
  return text
    .replace(/\r\n/g, "\n") // normalize line endings
    .replace(/\t/g, " ") // tabs to spaces
    .replace(/ {3,}/g, "  ") // collapse extra spaces
    .replace(/\n{4,}/g, "\n\n\n") // collapse excessive blank lines
    .trim();
}

export async function extractTextFromBuffer(
  buffer: Buffer,
  mimeType: string,
  filename: string
): Promise<string> {
  if (mimeType === "text/csv" || filename.toLowerCase().endsWith(".csv")) {
    return csvToKnowledgeText(buffer.toString("utf-8"), filename);
  }

  if (
    mimeType === "application/pdf" ||
    filename.toLowerCase().endsWith(".pdf")
  ) {
    const pdfParse = (await import("pdf-parse")).default;
    const result = await pdfParse(buffer);
    return result.text;
  }

  if (
    mimeType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    filename.toLowerCase().endsWith(".docx")
  ) {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  // Plain text / markdown / txt
  return buffer.toString("utf-8");
}

export function csvToKnowledgeText(csv: string, filename = "data.csv"): string {
  return csvToKnowledgeBatches(csv, filename)
    .map((batch) => batch.text)
    .join("\n\n");
}

export function csvToKnowledgeBatches(
  csv: string,
  filename = "data.csv"
): CsvKnowledgeBatch[] {
  const parsed = parse(csv, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    trim: true,
    max_record_size: 1_000_000,
  }) as Array<Record<string, unknown>>;

  if (parsed.length === 0) {
    throw new Error("The CSV file has no data rows.");
  }
  if (parsed.length > MAX_CSV_ROWS) {
    throw new Error(`CSV files can contain up to ${MAX_CSV_ROWS.toLocaleString()} data rows.`);
  }

  const records = parsed.map((record) =>
    Object.fromEntries(
      Object.entries(record)
        .map(([column, value]) => [column.trim(), String(value ?? "").trim()])
        .filter(([column]) => Boolean(column))
    )
  );
  const columns = Array.from(
    new Set(records.flatMap((record) => Object.keys(record)))
  );
  const batches: CsvKnowledgeBatch[] = [];
  let batchRecords: Array<Record<string, string>> = [];
  let batchTexts: string[] = [];
  let batchLength = 0;

  function flushBatch() {
    if (batchRecords.length === 0) return;
    batches.push({
      text: `CSV dataset: ${filename}\nColumns: ${columns.join(", ")}\n\n${batchTexts.join("\n\n")}`,
      metadata: {
        file_format: "csv",
        filename,
        csv_columns: columns,
        csv_records: batchRecords,
      },
    });
    batchRecords = [];
    batchTexts = [];
    batchLength = 0;
  }

  records.forEach((record, index) => {
    const fields = Object.entries(record)
      .filter(([, value]) => value)
      .map(([column, value]) => `${column}: ${value}`);
    if (fields.length === 0) return;
    const recordText = `Record ${index + 1}\n${fields.join("\n")}`;
    if (batchLength > 0 && batchLength + recordText.length > CSV_BATCH_CHARACTERS) {
      flushBatch();
    }
    batchRecords.push(record);
    batchTexts.push(recordText);
    batchLength += recordText.length;
  });
  flushBatch();

  if (batches.length === 0) {
    throw new Error("The CSV file has no usable values.");
  }
  return batches;
}
