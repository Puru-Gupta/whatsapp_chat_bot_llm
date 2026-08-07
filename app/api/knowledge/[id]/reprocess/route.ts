import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { generateEmbedding } from "@/lib/embeddings";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST: re-generate embeddings for all chunks of a source
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const supabase = createServiceClient();

  // Mark as processing
  await supabase
    .from("knowledge_sources")
    .update({ status: "processing" })
    .eq("id", id);

  // Fetch all chunks
  const { data: chunks, error: chunksError } = await supabase
    .from("knowledge_chunks")
    .select("id, content, metadata")
    .eq("source_id", id);

  if (chunksError) {
    await supabase
      .from("knowledge_sources")
      .update({ status: "error" })
      .eq("id", id);
    return NextResponse.json({ error: chunksError.message }, { status: 500 });
  }

  let successCount = 0;
  for (const chunk of chunks ?? []) {
    try {
      const metadata = chunk.metadata as Record<string, unknown> | null;
      const embedding = Array.isArray(metadata?.csv_records)
        ? null
        : await generateEmbedding(chunk.content);
      const { error } = await supabase
        .from("knowledge_chunks")
        .update({ embedding })
        .eq("id", chunk.id);
      if (error) throw error;
      successCount++;
    } catch (err) {
      console.error(`Reprocess failed for chunk ${chunk.id}:`, err);
    }
  }

  const { data: updated } = await supabase
    .from("knowledge_sources")
    .update({
      status:
        successCount === (chunks?.length ?? 0) && successCount > 0
          ? "active"
          : "error",
      chunk_count: chunks?.length ?? 0,
    })
    .eq("id", id)
    .select()
    .single();

  return NextResponse.json({
    source: updated,
    reprocessed: successCount,
    total: chunks?.length ?? 0,
  });
}
