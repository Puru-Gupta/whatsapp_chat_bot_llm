import { after, NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { sendWhatsAppMessage, verifyWebhookToken } from "@/lib/whatsapp";
import {
  searchKnowledge,
  buildContextBlock,
  resolveRetrievalQuery,
} from "@/lib/rag";
import { generateAIResponse, NO_ANSWER_REPLY } from "@/lib/ai";
import { answerCsvQuestion } from "@/lib/csv-query";
import { addDocumentReference } from "@/lib/answer-references";
import { addDataCoverageNotice } from "@/lib/data-coverage";
import {
  BACKEND_UNAVAILABLE_REPLY,
  isBackendUnreachable,
} from "@/lib/backend-health";
import {
  isConversationResetRequest,
  prepareConversationHistory,
} from "@/lib/conversation-history";
import type {
  WhatsAppWebhookPayload,
  WebhookMessage,
  WebhookContact,
  Conversation,
} from "@/types";

export const runtime = "nodejs";
export const maxDuration = 60;


// ─── GET: Webhook Verification ───────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token && verifyWebhookToken(token)) {
    return new NextResponse(challenge ?? "", { status: 200 });
  }

  return new NextResponse("Forbidden", { status: 403 });
}

// ─── POST: Incoming Messages ──────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  let payload: WhatsAppWebhookPayload;

  try {
    payload = (await req.json()) as WhatsAppWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  after(async () => {
    try {
      await processWebhook(payload);
    } catch (err) {
      console.error("Webhook processing error:", err);
    }
  });

  return new NextResponse("OK", { status: 200 });
}

async function processWebhook(payload: WhatsAppWebhookPayload) {
  if (payload.object !== "whatsapp_business_account") return;

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;

      const value = change.value;
      const messages = value.messages ?? [];
      const contacts = value.contacts ?? [];

      for (const message of messages) {
        await handleMessage(message, contacts);
      }
    }
  }
}

async function handleMessage(
  message: WebhookMessage,
  contacts: WebhookContact[]
) {
  // Only handle text messages for now
  if (message.type !== "text" || !message.text?.body) return;

  const supabase = createServiceClient();
  const phone = message.from;
  const msgId = message.id;
  const text = message.text.body.trim();
  const contactName =
    contacts.find((c) => c.wa_id === phone)?.profile?.name ?? null;

  if (!text) return;

  // Persistence is best-effort. If the database is unreachable the sender must
  // still get a reply rather than silence, so track availability instead of
  // returning early on infrastructure errors.
  let storageOnline = true;

  // ── Dedup: skip if message ID already processed ───────────────────────────
  const { data: existing, error: dedupError } = await supabase
    .from("messages")
    .select("id")
    .eq("whatsapp_msg_id", msgId)
    .maybeSingle();

  if (existing) return;
  if (isBackendUnreachable(dedupError)) storageOnline = false;

  // ── Find or create conversation ───────────────────────────────────────────
  let conversation: Conversation | null = null;

  if (storageOnline) {
    const { data: found, error: lookupError } = await supabase
      .from("conversations")
      .select("*")
      .eq("phone", phone)
      .maybeSingle();

    if (isBackendUnreachable(lookupError)) {
      storageOnline = false;
    } else if (found) {
      conversation = found;
      if (contactName && !found.name) {
        // Update name if we now have it
        await supabase
          .from("conversations")
          .update({ name: contactName })
          .eq("id", found.id);
      }
    } else {
      const { data: newConv, error } = await supabase
        .from("conversations")
        .insert({ phone, name: contactName })
        .select()
        .single();

      if (newConv) {
        conversation = newConv;
      } else {
        console.error("Failed to create conversation:", error);
        if (!isBackendUnreachable(error)) return;
        storageOnline = false;
      }
    }
  }

  // ── Store user message ────────────────────────────────────────────────────
  if (conversation) {
    const { error: messageError } = await supabase.from("messages").insert({
      conversation_id: conversation.id,
      role: "user",
      content: text,
      whatsapp_msg_id: msgId,
      source: "whatsapp",
    });

    if (messageError) {
      // A unique violation means a concurrent delivery already handled this
      // message; anything else is logged but must not block the reply.
      if (messageError.code === "23505") return;
      console.error("Failed to store incoming message:", messageError);
      if (!isBackendUnreachable(messageError)) return;
      storageOnline = false;
    } else {
      await supabase
        .from("conversations")
        .update({
          last_message: text,
          unread_count: (conversation.unread_count ?? 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq("id", conversation.id);
    }
  }

  // ── Human mode: stop here ─────────────────────────────────────────────────
  if (conversation?.mode === "human") return;

  // ── Agent mode: grounded knowledge response ──────────────────────────────
  const startedAt = Date.now();
  const logId = msgId.slice(-12);
  let reply = addDocumentReference(
    { text: NO_ANSWER_REPLY, source: "not_found" },
    text,
    false
  );
  let answerSource = "not_found";
  let backendDown = !storageOnline;

  if (isConversationResetRequest(text)) {
    reply =
      "Done — I’ve reset the conversation context. What would you like to explore about AQLI?\n\nTry asking: “Give top 5 countries by PM2.5.”\n\nReference: Conversation context.";
    answerSource = "reset";
  } else {
    try {
    // Fetch the newest messages, then restore chronological order. Exclude the
    // current message so it is not added to the model prompt twice.
    const { data: recentHistory, error: historyError } = conversation
      ? await supabase
          .from("messages")
          .select("*")
          .eq("conversation_id", conversation.id)
          .order("created_at", { ascending: false })
          .limit(13)
      : { data: null, error: null };

    if (historyError) {
      console.warn("[webhook] history unavailable", {
        messageId: logId,
        code: historyError.code,
      });
    }

    const history = prepareConversationHistory(
      recentHistory ?? [],
      msgId
    );
    const resolved = resolveRetrievalQuery(text, history);
    const retrievalQuery = resolved.query;
    const csvAnswer = await answerCsvQuestion(retrievalQuery, {
      currentQuery: text,
      usedConversationContext: resolved.usedConversationContext,
    });
    let chunkCount = 0;
    let answerModel: string | undefined;

    if (csvAnswer) {
      reply = csvAnswer;
      answerSource = "data";
    } else {
      const relevantChunks = await searchKnowledge(retrievalQuery);
      chunkCount = relevantChunks.length;
      const contextBlock = buildContextBlock(relevantChunks);
      const answer = await generateAIResponse(
        text,
        contextBlock,
        history,
        retrievalQuery
      );
      reply = addDocumentReference(
        answer,
        retrievalQuery,
        resolved.usedConversationContext
      );
      answerSource = answer.source;
      answerModel = answer.model;
    }

    console.log("[webhook] grounded answer ready", {
      messageId: logId,
      historyMessages: history.length,
      usedConversationContext: resolved.usedConversationContext,
      chunks: chunkCount,
      source: answerSource,
      model: answerModel,
      elapsedMs: Date.now() - startedAt,
    });
    } catch (err) {
      console.error("[webhook] answer generation failed", {
        messageId: logId,
        error: err instanceof Error ? err.message : String(err),
      });
      if (isBackendUnreachable(err)) backendDown = true;
    }
  }

  if (backendDown) {
    // Never claim the knowledge base lacks an answer when we simply could not
    // reach it — that misleads the sender into rephrasing a fine question.
    reply = BACKEND_UNAVAILABLE_REPLY;
    answerSource = "backend_unavailable";
  } else {
    reply = addDataCoverageNotice(reply);
  }

  // Send exactly once. A send failure must never trigger a second fallback
  // message because the first request may already have reached WhatsApp.
  try {
    await sendWhatsAppMessage(phone, reply);
  } catch (err) {
    console.error("[webhook] WhatsApp send failed", {
      messageId: logId,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  // The reply is already delivered; logging the transcript is best-effort and
  // is skipped entirely when the database was unreachable.
  if (!conversation) return;

  const { error: assistantMessageError } = await supabase.from("messages").insert({
    conversation_id: conversation.id,
    role: "assistant",
    content: reply,
    source: `ai:${answerSource}`,
  });

  if (assistantMessageError) {
    console.error("[webhook] failed to store assistant message", {
      messageId: logId,
      code: assistantMessageError.code,
    });
  }

  const { error: conversationUpdateError } = await supabase
    .from("conversations")
    .update({
      last_message: reply,
      updated_at: new Date().toISOString(),
    })
    .eq("id", conversation.id);

  if (conversationUpdateError) {
    console.error("[webhook] failed to update conversation", {
      messageId: logId,
      code: conversationUpdateError.code,
    });
  }
}
