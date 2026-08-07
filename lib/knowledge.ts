import { createHash } from "node:crypto";
import { chunkText } from "@/lib/chunking";
import { generateEmbedding } from "@/lib/embeddings";
import { createServiceClient } from "@/lib/supabase/server";
import type { KnowledgeSource } from "@/types";

const INSERT_BATCH_SIZE = 100;
const EMBEDDING_CONCURRENCY = 6;

export interface KnowledgeDocument {
  text: string;
  metadata?: Record<string, unknown>;
}

export interface IngestKnowledgeInput {
  title: string;
  sourceType: KnowledgeSource["source_type"];
  sourceUrl?: string | null;
  filePath?: string | null;
  documents: KnowledgeDocument[];
}

export interface IngestKnowledgeResult {
  source: KnowledgeSource;
  chunksCreated: number;
  chunksTotal: number;
}

interface PreparedChunk {
  content: string;
  metadata: Record<string, unknown>;
}

export class KnowledgeIngestionError extends Error {
  constructor(
    message: string,
    public readonly status = 400
  ) {
    super(message);
    this.name = "KnowledgeIngestionError";
  }
}

export async function ingestKnowledge(
  input: IngestKnowledgeInput
): Promise<IngestKnowledgeResult> {
  const title = input.title.trim();
  if (!title) throw new KnowledgeIngestionError("Title is required.");
  if (title.length > 160) {
    throw new KnowledgeIngestionError("Title must be 160 characters or fewer.");
  }

  const preparedChunks = prepareChunks(input.documents);
  const isStructuredCsv = input.documents.some((document) =>
    Array.isArray(document.metadata?.csv_records)
  );
  if (preparedChunks.length === 0) {
    throw new KnowledgeIngestionError(
      "No usable text was found. Add more text or choose a text-based document."
    );
  }

  const supabase = createServiceClient();
  let duplicateQuery = supabase
    .from("knowledge_sources")
    .select("id")
    .eq("title", title)
    .eq("source_type", input.sourceType)
    .in("status", ["active", "processing"])
    .limit(1);

  if (input.sourceUrl) {
    duplicateQuery = duplicateQuery.eq("source_url", input.sourceUrl);
  }

  const { data: duplicate, error: duplicateError } = await duplicateQuery.maybeSingle();
  if (duplicateError) {
    throw new KnowledgeIngestionError(
      `Could not check existing sources: ${duplicateError.message}`,
      500
    );
  }
  if (duplicate && !isStructuredCsv) {
    throw new KnowledgeIngestionError(
      "This source is already in the knowledge base.",
      409
    );
  }

  const { data: source, error: sourceError } = await supabase
    .from("knowledge_sources")
    .insert({
      title,
      source_type: input.sourceType,
      source_url: input.sourceUrl ?? null,
      file_path: input.filePath ?? null,
      status: "processing",
    })
    .select()
    .single();

  if (sourceError || !source) {
    throw new KnowledgeIngestionError(
      sourceError?.message ?? "Could not create the knowledge source.",
      500
    );
  }

  try {
    const rows = await mapWithConcurrency(
      preparedChunks,
      EMBEDDING_CONCURRENCY,
      async (chunk, index) => ({
        source_id: source.id,
        chunk_index: index,
        content: chunk.content,
        metadata: {
          title,
          source_type: input.sourceType,
          source_url: input.sourceUrl ?? null,
          chunk_index: index,
          ...chunk.metadata,
        },
        // Structured CSV rows are queried directly, so vectorizing them only
        // slows large uploads without improving numeric answers.
        embedding: Array.isArray(chunk.metadata.csv_records)
          ? null
          : await generateEmbedding(chunk.content),
      })
    );

    let insertedCount = 0;
    for (let index = 0; index < rows.length; index += INSERT_BATCH_SIZE) {
      const batch = rows.slice(index, index + INSERT_BATCH_SIZE);
      const { error } = await supabase.from("knowledge_chunks").insert(batch);
      if (error) throw error;
      insertedCount += batch.length;
    }

    const { data: updated, error: updateError } = await supabase
      .from("knowledge_sources")
      .update({ status: "active", chunk_count: insertedCount })
      .eq("id", source.id)
      .select()
      .single();

    if (updateError || !updated) {
      throw updateError ?? new Error("Could not activate the knowledge source.");
    }

    return {
      source: updated as KnowledgeSource,
      chunksCreated: insertedCount,
      chunksTotal: rows.length,
    };
  } catch (error) {
    await supabase.from("knowledge_chunks").delete().eq("source_id", source.id);
    await supabase
      .from("knowledge_sources")
      .update({ status: "error", chunk_count: 0 })
      .eq("id", source.id);

    console.error("[knowledge] ingestion failed", {
      sourceId: source.id,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new KnowledgeIngestionError(
      "The source could not be indexed. Check the content and try again.",
      500
    );
  }
}

function prepareChunks(documents: KnowledgeDocument[]): PreparedChunk[] {
  const seen = new Set<string>();
  const chunks: PreparedChunk[] = [];

  for (const document of documents) {
    if (Array.isArray(document.metadata?.csv_records)) {
      const content = document.text.trim();
      if (content.length < 20) continue;
      const digest = createHash("sha256")
        .update(content.replace(/\s+/g, " ").toLowerCase())
        .digest("hex");
      if (seen.has(digest)) continue;
      seen.add(digest);
      chunks.push({ content, metadata: document.metadata ?? {} });
      continue;
    }

    for (const content of chunkText(document.text)) {
      const normalized = content.replace(/\s+/g, " ").trim().toLowerCase();
      const digest = createHash("sha256").update(normalized).digest("hex");
      if (seen.has(digest)) continue;
      seen.add(digest);
      chunks.push({ content, metadata: document.metadata ?? {} });
    }
  }

  return chunks;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, runWorker)
  );
  return results;
}
