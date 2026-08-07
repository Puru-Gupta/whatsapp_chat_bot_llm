import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRetrievalQuery,
  rankKnowledgeChunks,
  resolveRetrievalQuery,
} from "../lib/rag";
import type { KnowledgeChunk, Message } from "../types";

const chunks: KnowledgeChunk[] = [
  {
    id: "south-asia",
    source_id: "report",
    chunk_index: 1,
    content:
      "In 2023, PM2.5 concentrations in South Asia were 2.9 percent higher than in 2022.",
    metadata: { title: "AQLI Annual Report", source_type: "pdf" },
  },
  {
    id: "canada",
    source_id: "report",
    chunk_index: 2,
    content:
      "Record-breaking wildfires in Canada pushed pollution to its highest level since 1998.",
    metadata: { title: "AQLI Annual Report", source_type: "pdf" },
  },
  {
    id: "toc",
    source_id: "report",
    chunk_index: 0,
    content:
      "Section 1 Overview Section 2 Data Section 3 Asia Section 4 Canada Section 5 Methods",
    metadata: { title: "AQLI Annual Report", source_type: "pdf" },
  },
  {
    id: "at-a-glance",
    source_id: "report",
    chunk_index: 0,
    content: `AQLI Annual Report 2026 ${"Table of Contents Section 1 Section 2 Section 3 Section 4 At a Glance ".repeat(20)}Particulate pollution remains the world's greatest external threat to human health. If global PM2.5 levels met the WHO guideline of 5 ug/m3, the average person could live 2.1 years longer.`,
    metadata: { title: "AQLI Annual Report 2026", source_type: "doc" },
  },
  {
    id: "website-definition",
    source_id: "website",
    chunk_index: 0,
    content:
      "The Air Quality Life Index (AQLI) converts air pollution concentrations into their impact on life expectancy.",
    metadata: { title: "AQLI Website", source_type: "website" },
  },
];

test("ranks a direct multi-term passage first", () => {
  const result = rankKnowledgeChunks("South Asia PM2.5", chunks);
  assert.equal(result[0]?.id, "south-asia");
});

test("matches two-word wildfire phrasing and ignores summary intent", () => {
  const result = rankKnowledgeChunks("Give summary of Canada wild fire", chunks);
  assert.equal(result[0]?.id, "canada");
});

test("handles spelling mistakes and shuffled query words", () => {
  const result = rankKnowledgeChunks("summry fire cnada wild explan", chunks);
  assert.equal(result[0]?.id, "canada");
});

test("understands a misspelled Canada wildfire story request", () => {
  const result = rankKnowledgeChunks("What is canada wildfore story", chunks);
  assert.equal(result[0]?.id, "canada");
});

test("keeps AQLI searchable for website definition questions", () => {
  const result = rankKnowledgeChunks("What is AQLI?", chunks);
  assert.equal(result[0]?.id, "website-definition");
});

test("carries the original subject through chained follow-up questions", () => {
  const history = [
    {
      id: "1",
      conversation_id: "conversation",
      role: "user",
      content: "Canada wild fire",
      created_at: "2026-06-27T10:00:00.000Z",
    },
    {
      id: "2",
      conversation_id: "conversation",
      role: "assistant",
      content: "Canada's wildfires worsened air quality.",
      created_at: "2026-06-27T10:00:01.000Z",
    },
    {
      id: "3",
      conversation_id: "conversation",
      role: "user",
      content: "How much did it change?",
      created_at: "2026-06-27T10:00:02.000Z",
    },
  ] satisfies Message[];

  assert.equal(
    buildRetrievalQuery("and compared with the US?", history),
    "Canada wild fire How much did it change? and compared with the US?"
  );
});

test("does not attach a previous topic to a standalone short question", () => {
  const history = [
    {
      id: "1",
      conversation_id: "conversation",
      role: "user",
      content: "What is pollution level in India?",
      created_at: "2026-06-27T10:00:00.000Z",
    },
  ] satisfies Message[];

  assert.equal(
    buildRetrievalQuery("Annual report summary?", history),
    "Annual report summary?"
  );
});

test("keeps a clear location through a chain of short follow-ups", () => {
  const history = [
    {
      id: "1",
      conversation_id: "conversation",
      role: "user",
      content: "Tell me about Uttar Pradesh",
      created_at: "2026-06-27T10:00:00.000Z",
    },
    {
      id: "2",
      conversation_id: "conversation",
      role: "user",
      content: "What about its districts?",
      created_at: "2026-06-27T10:00:01.000Z",
    },
    {
      id: "3",
      conversation_id: "conversation",
      role: "user",
      content: "Only in this state",
      created_at: "2026-06-27T10:00:02.000Z",
    },
  ] satisfies Message[];

  const resolved = resolveRetrievalQuery("Rank them", history);
  assert.equal(resolved.usedConversationContext, true);
  assert.equal(
    resolved.query,
    "Tell me about Uttar Pradesh What about its districts? Only in this state Rank them"
  );
});

test("treats an each-states question as a follow-up to the selected country", () => {
  const history = [
    {
      id: "1",
      conversation_id: "conversation",
      role: "user",
      content: "I want Pakistan's most polluted state",
      created_at: "2026-06-28T04:19:41.000Z",
    },
  ] satisfies Message[];
  const resolved = resolveRetrievalQuery(
    "What is life year loss of each states",
    history
  );
  assert.equal(resolved.usedConversationContext, true);
  assert.match(resolved.query, /Pakistan/);
});

test("joins a short answer to the bot's clarification question", () => {
  const history = [
    {
      id: "1",
      conversation_id: "conversation",
      role: "user",
      content: "List all states by life loss",
      created_at: "2026-06-28T05:00:00.000Z",
    },
    {
      id: "2",
      conversation_id: "conversation",
      role: "assistant",
      content:
        "Which country should I list the states for?\n\nReference checked: GADM1 CSV.",
      created_at: "2026-06-28T05:00:01.000Z",
    },
  ] satisfies Message[];

  const resolved = resolveRetrievalQuery("Pakistan", history);
  assert.equal(resolved.usedConversationContext, true);
  assert.equal(resolved.query, "List all states by life loss Pakistan");
});

test("does not consume a greeting as a clarification answer", () => {
  const history = [
    {
      id: "1",
      conversation_id: "conversation",
      role: "user",
      content: "Which state increased most?",
      created_at: "2026-06-28T06:08:00.000Z",
    },
    {
      id: "2",
      conversation_id: "conversation",
      role: "assistant",
      content: "Which country should I use?",
      created_at: "2026-06-28T06:08:01.000Z",
    },
  ] satisfies Message[];

  assert.deepEqual(resolveRetrievalQuery("Hi", history), {
    query: "Hi",
    usedConversationContext: false,
  });
});

test("uses the place returned in the previous answer for a demonstrative follow-up", () => {
  const history = [
    {
      id: "1",
      conversation_id: "conversation",
      role: "user",
      content: "What is most polluted state in Bangladesh",
      created_at: "2026-06-29T14:19:20.000Z",
    },
    {
      id: "2",
      conversation_id: "conversation",
      role: "assistant",
      content:
        "Here is the top state in Bangladesh, 2024:\n1. Dhaka — 71.9 µg/m³ PM2.5.\n\nReference: GADM1 CSV.",
      created_at: "2026-06-29T14:19:29.000Z",
    },
  ] satisfies Message[];

  const resolved = resolveRetrievalQuery(
    "Compare this with pollution level in 2010",
    history
  );
  assert.equal(resolved.usedConversationContext, true);
  assert.match(resolved.query, /Previous answer:[\s\S]*Dhaka/);
});

test("treats a benchmark-only metric question as a location follow-up", () => {
  const history = [
    {
      id: "1",
      conversation_id: "conversation",
      role: "user",
      content: "Total life year loss in Dhaka",
      created_at: "2026-06-29T14:27:20.000Z",
    },
    {
      id: "2",
      conversation_id: "conversation",
      role: "assistant",
      content: "Dhaka, 2024: 6.5 years life loss.\n\nReference: GADM1 CSV.",
      created_at: "2026-06-29T14:27:23.000Z",
    },
  ] satisfies Message[];

  const resolved = resolveRetrievalQuery(
    "Total life year loss as per WHO guideline and national standard in 2024?",
    history
  );
  assert.equal(resolved.usedConversationContext, true);
  assert.match(resolved.query, /Dhaka/);
});

test("does not merge a complete numeric filter with the previous filter", () => {
  const history = [
    {
      id: "1",
      conversation_id: "conversation",
      role: "user",
      content: "List countries with national standard less than 20",
      created_at: "2026-06-29T15:18:52.000Z",
    },
    {
      id: "2",
      conversation_id: "conversation",
      role: "assistant",
      content: "Countries with national standard below 20.",
      created_at: "2026-06-29T15:18:53.000Z",
    },
  ] satisfies Message[];

  assert.deepEqual(
    resolveRetrievalQuery(
      "Give list of countries that have national standard more than 30",
      history
    ),
    {
      query: "Give list of countries that have national standard more than 30",
      usedConversationContext: false,
    }
  );
});

test("does not attach stale district context to a complete benchmark comparison", () => {
  const history = [
    {
      id: "1",
      conversation_id: "conversation",
      role: "user",
      content: "Top polluted districts in India",
      created_at: "2026-07-04T06:20:00.000Z",
    },
    {
      id: "2",
      conversation_id: "conversation",
      role: "assistant",
      content: "District-level data is not available. Would you like state-level results?",
      created_at: "2026-07-04T06:20:02.000Z",
    },
  ] satisfies Message[];

  const current =
    "Compare Bihar and Uttar Pradesh life year loss as per national standard";
  assert.deepEqual(resolveRetrievalQuery(current, history), {
    query: current,
    usedConversationContext: false,
  });
});

test("keeps identity questions outside clarification context", () => {
  const history = [
    {
      id: "1",
      conversation_id: "conversation",
      role: "assistant",
      content: "Which country should I use?",
      created_at: "2026-06-29T15:20:00.000Z",
    },
  ] satisfies Message[];
  assert.deepEqual(resolveRetrievalQuery("Who are you?", history), {
    query: "Who are you?",
    usedConversationContext: false,
  });
});

test("retrieves a substantive At a Glance section despite its contents header", () => {
  const result = rankKnowledgeChunks("Main highlight of repot?", chunks);
  assert.equal(result[0]?.id, "at-a-glance");
});

test("rejects unrelated knowledge instead of forcing a match", () => {
  assert.deepEqual(rankKnowledgeChunks("employee refund policy", chunks), []);
});

test("requires a requested year to appear in the evidence", () => {
  assert.deepEqual(rankKnowledgeChunks("South Asia PM2.5 2024", chunks), []);
});

test("filters table-of-contents style chunks", () => {
  assert.equal(
    rankKnowledgeChunks("Canada methods overview", chunks).some(
      (chunk) => chunk.id === "toc"
    ),
    false
  );
});
