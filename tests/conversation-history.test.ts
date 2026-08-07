import test from "node:test";
import assert from "node:assert/strict";
import {
  isConversationResetRequest,
  prepareConversationHistory,
} from "../lib/conversation-history";
import type { Message } from "../types";

test("keeps assistant messages with null WhatsApp IDs in conversation history", () => {
  const messages = [
    {
      id: "current",
      conversation_id: "conversation",
      role: "user",
      content: "India",
      whatsapp_msg_id: "current-id",
      source: "whatsapp",
      created_at: "2026-06-28T05:08:34.000Z",
    },
    {
      id: "clarification",
      conversation_id: "conversation",
      role: "assistant",
      content: "Sure. Which country should I use for the top 5 states?",
      whatsapp_msg_id: null,
      source: "ai:data",
      created_at: "2026-06-28T05:08:24.000Z",
    },
    {
      id: "question",
      conversation_id: "conversation",
      role: "user",
      content: "Give top 5 states",
      whatsapp_msg_id: "question-id",
      source: "whatsapp",
      created_at: "2026-06-28T05:08:23.000Z",
    },
  ] satisfies Message[];

  const history = prepareConversationHistory(messages, "current-id");
  assert.deepEqual(
    history.map((message) => message.id),
    ["question", "clarification"]
  );
});

test("drops messages before the most recent conversation reset", () => {
  const messages = [
    {
      id: "after",
      conversation_id: "conversation",
      role: "assistant",
      content: "Conversation reset.",
      whatsapp_msg_id: null,
      source: "ai:reset",
      created_at: "2026-06-28T06:09:42.000Z",
    },
    {
      id: "reset",
      conversation_id: "conversation",
      role: "user",
      content: "Please reset this conversation",
      whatsapp_msg_id: "reset-id",
      source: "whatsapp",
      created_at: "2026-06-28T06:09:41.000Z",
    },
    {
      id: "old",
      conversation_id: "conversation",
      role: "user",
      content: "Old question",
      whatsapp_msg_id: "old-id",
      source: "whatsapp",
      created_at: "2026-06-28T06:09:00.000Z",
    },
  ] satisfies Message[];

  assert.deepEqual(
    prepareConversationHistory(messages, "current-id").map((message) => message.id),
    ["after"]
  );
});

test("accepts reset as a standalone command only", () => {
  assert.equal(isConversationResetRequest("reset"), true);
  assert.equal(isConversationResetRequest(" Reset! "), true);
  assert.equal(isConversationResetRequest("Please reset this conversation"), true);
  assert.equal(isConversationResetRequest("What does reset mean?"), false);
});
