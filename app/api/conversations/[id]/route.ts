import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

// PATCH /api/conversations/[id] — update mode or reset unread
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const supabase = createServiceClient();
  const body = await req.json();

  const updates: Record<string, unknown> = {};
  if (body.mode) {
    if (body.mode !== "agent" && body.mode !== "human") {
      return NextResponse.json({ error: "Invalid mode" }, { status: 400 });
    }
    updates.mode = body.mode;
  }

  if (body.unread_count !== undefined) {
    const unreadCount = Number(body.unread_count);
    if (!Number.isInteger(unreadCount) || unreadCount < 0) {
      return NextResponse.json(
        { error: "Invalid unread count" },
        { status: 400 }
      );
    }
    updates.unread_count = unreadCount;
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No updates provided" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("conversations")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}
