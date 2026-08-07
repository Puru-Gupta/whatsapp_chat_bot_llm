import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import {
  ingestKnowledge,
  KnowledgeIngestionError,
} from "@/lib/knowledge";
import {
  crawlWebsite,
  normalizeWebsiteUrl,
  WebsiteImportError,
} from "@/lib/website";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;

  try {
    const body = await req.json();
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const rawUrl = typeof body.url === "string" ? body.url : "";
    const mode = body.mode === "page" ? "page" : "site";

    if (!title) {
      return NextResponse.json({ error: "Title is required." }, { status: 400 });
    }

    const normalizedUrl = normalizeWebsiteUrl(rawUrl);
    const crawl = await crawlWebsite(normalizedUrl, { mode, maxPages: 12 });
    const result = await ingestKnowledge({
      title,
      sourceType: "website",
      sourceUrl: crawl.startUrl,
      documents: crawl.documents,
    });

    console.log("[knowledge/website] import complete", {
      sourceId: result.source.id,
      pages: crawl.documents.length,
      chunks: result.chunksCreated,
    });

    return NextResponse.json({
      source: result.source,
      pages_indexed: crawl.documents.length,
      pages_visited: crawl.pagesVisited,
      chunks_created: result.chunksCreated,
      chunks_total: result.chunksTotal,
      warnings: crawl.warnings,
    });
  } catch (error) {
    if (error instanceof WebsiteImportError || error instanceof KnowledgeIngestionError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }

    console.error("[knowledge/website] import failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "The website could not be imported." },
      { status: 500 }
    );
  }
}
