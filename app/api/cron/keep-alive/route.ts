import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

// Supabase free-tier projects pause after 7 days without database activity.
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const { error } = await supabase
    .from("knowledge_sources")
    .select("id", { head: true, count: "exact" })
    .limit(1);

  if (error) {
    console.error("[keep-alive] Supabase query failed", { error: error.message });
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, at: new Date().toISOString() });
}
