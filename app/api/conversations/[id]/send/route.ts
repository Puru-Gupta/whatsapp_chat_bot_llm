import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { sendWhatsAppMessage } from "@/lib/whatsapp";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const unauthorized = await requireAdmin();
  if (unauthorized) return unauthorized;

  const { id } = await params;
  const supabase = createServiceClient();
  const { message } = await req.json();
  const text = typeof message === "string" ? message.trim() : "";

  if (!text) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }

  // Get conversation
  const { data: conversation, error: convError } = await supabase
    .from("conversations")
    .select("*")
    .eq("id", id)
    .single();

  if (convError || !conversation) {
    return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  }

  // Send via WhatsApp
  try {
    await sendWhatsAppMessage(conversation.phone, text);
  } catch (err) {
    console.error("Manual WhatsApp send failed:", err);
    return NextResponse.json(
      { error: "Message could not be sent through WhatsApp" },
      { status: 502 }
    );
  }

  // Store as human/assistant message
  const { data: stored, error } = await supabase
    .from("messages")
    .insert({
      conversation_id: id,
      role: "human",
      content: text,
      source: "dashboard",
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Update conversation last_message
  await supabase
    .from("conversations")
    .update({
      last_message: text,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  return NextResponse.json(stored);
}
