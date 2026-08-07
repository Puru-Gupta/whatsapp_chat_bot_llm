import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import {
  csvToKnowledgeBatches,
  extractTextFromBuffer,
} from "@/lib/chunking";
import {
  ingestKnowledge,
  KnowledgeIngestionError,
} from "@/lib/knowledge";
import type { KnowledgeDocument } from "@/lib/knowledge";
import {
  inferCsvDatasetLevel,
  type CsvDatasetLevel,
} from "@/lib/csv-sources";
import { createServiceClient } from "@/lib/supabase/server";
import type { KnowledgeSource } from "@/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_MANUAL_CHARACTERS = 2_000_000;
const ALLOWED_EXTENSIONS = new Set(["pdf", "docx", "txt", "md", "csv"]);

export async function POST(req: NextRequest) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;

  try {
    const formData = await req.formData();
    const title = readFormString(formData, "title");
    const manualText = readFormString(formData, "manual_text");
    const fileValue = formData.get("file");
    const file = fileValue instanceof File && fileValue.size > 0 ? fileValue : null;

    if (!title) {
      return NextResponse.json({ error: "Title is required." }, { status: 400 });
    }

    let documents: KnowledgeDocument[];
    let sourceType: KnowledgeSource["source_type"];
    let filePath: string | null = null;
    let metadata: Record<string, unknown> = {};
    let csvLevel: CsvDatasetLevel | undefined;

    if (file) {
      if (file.size > MAX_FILE_BYTES) {
        return NextResponse.json(
          { error: "The file must be 25 MB or smaller." },
          { status: 413 }
        );
      }

      const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
      if (!ALLOWED_EXTENSIONS.has(extension)) {
        return NextResponse.json(
          { error: "Use a PDF, DOCX, CSV, TXT, or Markdown file." },
          { status: 415 }
        );
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      try {
        if (extension === "csv") {
          documents = csvToKnowledgeBatches(
            buffer.toString("utf-8"),
            file.name
          );
          const csvColumns = documents[0]?.metadata?.csv_columns;
          csvLevel = inferCsvDatasetLevel({
            title,
            filePath: file.name,
            columns: Array.isArray(csvColumns)
              ? csvColumns.filter(
                  (column): column is string => typeof column === "string"
                )
              : undefined,
          });
        } else {
          const rawText = await extractTextFromBuffer(
            buffer,
            file.type,
            file.name
          );
          documents = [{ text: rawText, metadata }];
        }
      } catch (extractError) {
        return NextResponse.json(
          {
            error:
              extractError instanceof Error
                ? extractError.message
                : "The file could not be read.",
          },
          { status: 400 }
        );
      }
      sourceType = inferSourceType(extension);
      filePath = file.name;
      metadata = { filename: file.name, file_format: extension };
      if (extension !== "csv") {
        documents = documents!.map((document) => ({ ...document, metadata }));
      }
    } else if (manualText) {
      if (manualText.length > MAX_MANUAL_CHARACTERS) {
        return NextResponse.json(
          { error: "Pasted text is too large." },
          { status: 413 }
        );
      }
      documents = [{ text: manualText, metadata }];
      sourceType = readFormString(formData, "source_type") === "faq" ? "faq" : "manual";
    } else {
      return NextResponse.json(
        { error: "Add a file or paste some text." },
        { status: 400 }
      );
    }

    const result = await ingestKnowledge({
      title,
      sourceType,
      filePath,
      documents,
    });

    if (csvLevel) {
      await deactivateOlderCsvSources(result.source.id, csvLevel);
    }

    console.log("[knowledge/upload] import complete", {
      sourceId: result.source.id,
      type: sourceType,
      chunks: result.chunksCreated,
    });

    return NextResponse.json({
      source: result.source,
      chunks_created: result.chunksCreated,
      chunks_total: result.chunksTotal,
    });
  } catch (error) {
    if (error instanceof KnowledgeIngestionError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }

    console.error("[knowledge/upload] import failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "The source could not be imported." },
      { status: 500 }
    );
  }
}

async function deactivateOlderCsvSources(
  currentSourceId: string,
  level: CsvDatasetLevel
) {
  const supabase = createServiceClient();
  const { data: sources, error } = await supabase
    .from("knowledge_sources")
    .select("id, title, file_path")
    .eq("status", "active")
    .neq("id", currentSourceId);

  if (error) {
    console.warn("[knowledge/upload] could not inspect older CSV sources", {
      code: error.code,
    });
    return;
  }

  const olderIds: string[] = [];
  for (const source of sources ?? []) {
    if (!source.file_path?.toLowerCase().endsWith(".csv")) continue;
    let sourceLevel = inferCsvDatasetLevel({
      title: source.title,
      filePath: source.file_path,
    });
    if (!sourceLevel) {
      const { data: firstChunk } = await supabase
        .from("knowledge_chunks")
        .select("metadata")
        .eq("source_id", source.id)
        .order("chunk_index")
        .limit(1)
        .maybeSingle();
      const columns = Array.isArray(firstChunk?.metadata?.csv_columns)
        ? (firstChunk.metadata.csv_columns as unknown[]).filter(
            (column: unknown): column is string => typeof column === "string"
          )
        : undefined;
      sourceLevel = inferCsvDatasetLevel({ columns });
    }
    if (sourceLevel === level) olderIds.push(source.id);
  }

  if (olderIds.length === 0) return;
  const { error: updateError } = await supabase
    .from("knowledge_sources")
    .update({ status: "inactive" })
    .in("id", olderIds);
  if (updateError) {
    console.warn("[knowledge/upload] could not deactivate older CSV sources", {
      code: updateError.code,
    });
  }
}

function readFormString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function inferSourceType(extension: string): KnowledgeSource["source_type"] {
  if (extension === "pdf") return "pdf";
  if (extension === "docx") return "doc";
  return "txt";
}
