import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;

  const supabase = createServiceClient();
  const { searchParams } = req.nextUrl;
  const search = sanitizeSearch(searchParams.get("search") ?? "");

  let query = supabase
    .from("conversations")
    .select("*")
    .order("updated_at", { ascending: false });

  if (search) {
    query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%`);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(data);
}

function sanitizeSearch(value: string) {
  return value.replace(/[,%()]/g, " ").trim().slice(0, 80);
}
