import type { Message } from "@/types";

export function prepareConversationHistory(
  newestFirst: Message[],
  currentWhatsAppMessageId: string,
  limit = 12
): Message[] {
  const chronological = newestFirst
    .filter(
      (message) => message.whatsapp_msg_id !== currentWhatsAppMessageId
    )
    .slice(0, limit)
    .reverse();
  const resetIndex = chronological.findLastIndex(
    (message) =>
      message.role === "user" && isConversationResetRequest(message.content)
  );
  return resetIndex >= 0 ? chronological.slice(resetIndex + 1) : chronological;
}

export function isConversationResetRequest(value: string): boolean {
  const normalized = value.trim();
  return (
    /^reset[.!?]*$/i.test(normalized) ||
    /\b(?:reset|clear|restart|start over|new)\s+(?:this\s+)?(?:conversation|chat|context)\b/i.test(
      normalized
    )
  );
}
