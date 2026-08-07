import { createServiceClient } from "@/lib/supabase/server";
import {
  extractNumberTokens,
  normalizeSearchText,
  searchTokensMatch,
  tokenizeSearchText,
  tokenizeSearchTextAll,
} from "@/lib/text-search";
import type { KnowledgeChunk, Message } from "@/types";
import { isConversationResetRequest } from "@/lib/conversation-history";

const MATCH_COUNT = 6;
const PAGE_SIZE = 1_000;
const MAX_CANDIDATES = 5_000;
const MAX_CONTEXT_CHARS = 16_000;
const MAX_CHUNK_CONTEXT_CHARS = 4_000;

interface SourceJoin {
  title?: string;
  source_type?: string;
  source_url?: string | null;
  status?: string;
}

interface SearchableChunk extends KnowledgeChunk {
  knowledge_sources?: SourceJoin | SourceJoin[];
}

interface RankedChunk {
  chunk: KnowledgeChunk;
  score: number;
  matchedTokens: number;
  coverage: number;
  exactPhrase: boolean;
  numberMatch: boolean;
  passageCoverage: number;
  anchorsMatch: boolean;
}

const SEARCH_INTENT_TOKENS = new Set([
  "annual",
  "change",
  "contact",
  "country",
  "data",
  "decrease",
  "glance",
  "health",
  "highlight",
  "increase",
  "level",
  "life",
  "expectancy",
  "methodology",
  "overview",
  "pm25",
  "pollution",
  "region",
  "report",
  "summary",
  "trend",
  "website",
  "wildfire",
  "year",
]);

export async function searchKnowledge(query: string): Promise<KnowledgeChunk[]> {
  const candidates = await fetchActiveChunks();

  if (isAqliDefinitionQuery(query)) {
    const asksForDeveloper = /\bwho (?:developed|created)\b/i.test(query);
    const websiteMatch = candidates.find(
      (chunk) =>
        chunk.metadata?.source_type === "website" &&
        (asksForDeveloper
          ? /Developed by .*?Michael Greenstone/i.test(chunk.content)
          : /converts air pollution concentrations into their impact on life expectancy/i.test(
              chunk.content
            ))
    );
    if (websiteMatch) return [websiteMatch];
  }

  if (isPollutedCountriesQuery(query)) {
    const rankingTable = candidates.find((chunk) =>
      /Table 3\.1: Impacts of particulate pollution[\s\S]*?Bangladesh[\s\S]*?Pakistan[\s\S]*?India/i.test(
        chunk.content
      )
    );
    if (rankingTable) return [rankingTable];
  }

  if (isReportOverviewQuery(query)) {
    const atAGlance = candidates.find((chunk) =>
      hasSubstantiveAtAGlance(chunk.content)
    );
    if (atAGlance) return [atAGlance];
  }

  return rankKnowledgeChunks(query, candidates);
}

function isAqliDefinitionQuery(query: string): boolean {
  return /\b(?:what(?:'s| is) (?:the )?aqli|what does aqli do|who (?:developed|created) aqli|tell me about aqli)\b/i.test(
    query
  );
}

function isPollutedCountriesQuery(query: string): boolean {
  const tokens = tokenizeSearchText(query);
  return (
    tokens.includes("country") &&
    tokens.includes("pollution") &&
    /\b(most|top|ranking|rank)\b/i.test(query)
  );
}

function isReportOverviewQuery(query: string): boolean {
  const tokens = tokenizeSearchText(query);
  const namesReport =
    tokens.includes("report") ||
    tokens.includes("annual") ||
    /\bat a glance\b/i.test(query);
  return namesReport && tokens.includes("summary") && tokens.includes("glance");
}

export function buildRetrievalQuery(
  userMessage: string,
  conversationHistory: Message[]
): string {
  return resolveRetrievalQuery(userMessage, conversationHistory).query;
}

export function resolveRetrievalQuery(
  userMessage: string,
  conversationHistory: Message[]
): { query: string; usedConversationContext: boolean } {
  const lastMessage = conversationHistory.at(-1);
  const isClarificationReply =
    Boolean(lastMessage) &&
    (lastMessage!.role === "assistant" || lastMessage!.role === "human") &&
    isClarifyingQuestion(lastMessage!.content) &&
    !isConversationBoundary(userMessage) &&
    tokenizeSearchText(userMessage).length <= 6;
  const isFollowUp =
    isContextDependentQuestion(userMessage) || isClarificationReply;

  if (!isFollowUp) {
    return { query: userMessage, usedConversationContext: false };
  }

  const previousQuestions = [...conversationHistory]
    .reverse()
    .filter((message) => message.role === "user" && message.content.trim())
    .slice(0, 6);

  if (previousQuestions.length === 0) {
    return { query: userMessage, usedConversationContext: false };
  }

  const contextQuestions: Message[] = [];
  for (const question of previousQuestions) {
    contextQuestions.push(question);
    if (!isContextDependentQuestion(question.content)) break;
  }

  const previousAnswerContext =
    lastMessage &&
    (lastMessage.role === "assistant" || lastMessage.role === "human") &&
    !isClarifyingQuestion(lastMessage.content) &&
    (/\b(?:it|this|that|those|these|same)\b/i.test(userMessage) ||
      isBenchmarkContextFollowUp(userMessage))
      ? lastMessage.content.split(/\nReference(?: checked)?:/i)[0].trim().slice(0, 700)
      : undefined;

  return {
    query: [
      ...contextQuestions.reverse().map((message) => message.content.trim()),
      previousAnswerContext
        ? `Previous answer: ${previousAnswerContext}`
        : undefined,
      userMessage.trim(),
    ]
      .filter(Boolean)
      .join(" "),
    usedConversationContext: true,
  };
}

function isConversationBoundary(value: string): boolean {
  return (
    isConversationResetRequest(value) ||
    /^\s*(?:hi|hello|hey|thanks?|thank you|good (?:morning|afternoon|evening)|who are you|what can you do)\b/i.test(
      value
    )
  );
}

function isClarifyingQuestion(value: string): boolean {
  const answerText = value.split(/\nReference(?: checked)?:/i)[0].trim();
  return (
    answerText.includes("?") ||
    /^(?:which|do you mean|please (?:provide|choose|specify)|should I)\b/i.test(
      answerText
    )
  );
}

function isContextDependentQuestion(value: string): boolean {
  const tokens = tokenizeSearchText(value);
  const trimmed = value.trim();
  return (
    /^(and|also|what about|how about|compared|compare with|then|now|show trend|rank them|only in|by life|tell me more|more details|continue|elaborate)\b/i.test(
      trimmed
    ) ||
    (/\b(it|its|this|that|those|these|there|same|them|former|latter)\b/i.test(trimmed) &&
      tokens.length < 8 &&
      !isCompleteNumericFilter(trimmed)) ||
    ((hasWhoBenchmarkLanguage(trimmed) || /\b(?:national standard|latest year)\b/i.test(trimmed)) &&
      tokens.length < 6 &&
      !isCompleteNumericFilter(trimmed)) ||
    isBenchmarkContextFollowUp(trimmed) ||
    (/\b(?:each|all)\s+(?:of\s+the\s+)?(?:countries|states?|provinces?|districts?)\b/i.test(trimmed) &&
      !/\b(?:in|of)\s+[A-Z][\p{L}'’-]+/u.test(trimmed))
  );
}

function isBenchmarkContextFollowUp(value: string): boolean {
  if (!(hasWhoBenchmarkLanguage(value) || /\bnational standards?\b/i.test(value))) {
    return false;
  }
  if (
    /\b(?:countries|states?|provinces?|districts?|rank|ranking|top|bottom|compare|comparison|difference|versus|vs\.?)\b/i.test(value) ||
    isCompleteNumericFilter(value)
  ) {
    return false;
  }
  const namedPlaceAfterConnector = value.match(
    /\b(?:in|for|of)\s+(?!the\b|a\b|an\b|(?:19|20)\d{2}\b)([\p{L}][\p{L}'’-]*)/iu
  );
  return !namedPlaceAfterConnector;
}

function hasWhoBenchmarkLanguage(value: string): boolean {
  return /\bWHO\b/.test(value) || /\bwho (?:guideline|standard)\b/i.test(value);
}

function isCompleteNumericFilter(value: string): boolean {
  return (
    /\b(?:pm\s*2\.?5|pollution|population|life\s+(?:year\s+)?loss|national\s+(?:standards?|std|limit)|nat\s*(?:std|standard)|WHO(?: guideline)?)\b/i.test(
      value
    ) &&
    /(?:<=|>=|=<|=>|==|=|<|>|≤|≥|\b(?:(?:less|lower|more|greater|higher|fewer|smaller|larger) th[ae]n(?: or equal to)?|equal to or (?:less|more|greater|higher) than|below|under|short of|above|over|exceeds|exceeding|in excess of|at least|at most|no (?:more|less|greater|higher) than|not (?:more|less|greater) than|minimum of|maximum of|min of|max of|is(?: equal to| exactly)?|exactly equal to|equal to|equals(?: to)?|same as|equivalent to|exactly)\b)\s*\d/i.test(
      value
    )
  );
}

export function rankKnowledgeChunks(
  query: string,
  chunks: KnowledgeChunk[]
): KnowledgeChunk[] {
  const queryTokens = tokenizeSearchText(query);
  if (queryTokens.length === 0 || chunks.length === 0) return [];

  const usableChunks = chunks.filter(
    (chunk) => chunk.content.trim().length >= 40 && !isLowQualityChunk(chunk.content)
  );
  if (usableChunks.length === 0) return [];

  const documentTokens = usableChunks.map((chunk) =>
    tokenizeSearchTextAll(searchableText(chunk))
  );
  const documentFrequency = new Map<string, number>();

  for (const tokens of documentTokens) {
    for (const token of new Set(tokens)) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }

  const queryPhrase = normalizeSearchText(query);
  const requiredAnchors = queryTokens.filter(
    (token) => !SEARCH_INTENT_TOKENS.has(token) && !/^\d+$/.test(token)
  );
  const requiredNumbers = extractNumberTokens(query).filter(
    (number) => number.length === 4
  );

  const ranked: RankedChunk[] = usableChunks
    .map((chunk, index) => {
      const tokens = documentTokens[index];
      const tokenSet = new Set(tokens);
      const normalizedContent = normalizeSearchText(searchableText(chunk));
      const matched = queryTokens
        .map((queryToken) =>
          Array.from(tokenSet).find((token) => searchTokensMatch(queryToken, token))
        )
        .filter((token): token is string => Boolean(token));
      const passageCoverage = bestPassageCoverage(chunk.content, queryTokens);
      const anchorsMatch = requiredAnchors.every((anchor) =>
        Array.from(tokenSet).some((token) => searchTokensMatch(anchor, token))
      );
      const exactPhrase =
        queryPhrase.length >= 8 && normalizedContent.includes(queryPhrase);
      const numberMatch = requiredNumbers.every((number) =>
        normalizedContent.includes(number)
      );

      let score = 0;
      for (const token of matched) {
        const frequency = tokens.filter((candidate) => candidate === token).length;
        const idf =
          Math.log(
            (usableChunks.length + 1) /
              ((documentFrequency.get(token) ?? 0) + 0.5)
          ) + 1;
        score += idf * (1 + Math.log(Math.max(frequency, 1)));
      }

      const coverage = matched.length / queryTokens.length;
      score *= 0.75 + coverage;
      score += passageCoverage * 5;
      if (passageCoverage === 1) score += 3;
      if (exactPhrase) score += 5;
      const titleText = normalizeSearchText(
        [sourceTitle(chunk), pageTitle(chunk)].filter(Boolean).join(" ")
      );
      const titleTokens = new Set(tokenizeSearchText(titleText));
      const titleMatches = queryTokens.filter((queryToken) =>
        Array.from(titleTokens).some((token) => searchTokensMatch(queryToken, token))
      );
      score += titleMatches.length * 4;
      if (titleMatches.length === queryTokens.length) score += 5;
      if (titleText.includes(queryPhrase)) score += 4;
      if (!numberMatch) score *= 0.2;

      return {
        chunk,
        score,
        matchedTokens: matched.length,
        coverage,
        exactPhrase,
        numberMatch,
        passageCoverage,
        anchorsMatch,
      };
    })
    .filter(
      (candidate) =>
        candidate.matchedTokens > 0 &&
        candidate.numberMatch &&
        candidate.anchorsMatch &&
        (queryTokens.length === 1 ||
          (candidate.matchedTokens >= 2 &&
            candidate.coverage >= 0.45 &&
            candidate.passageCoverage >= 0.45))
    )
    .sort((left, right) => right.score - left.score);

  const top = ranked[0];
  if (!top || !isConfidentMatch(top, queryTokens.length)) return [];

  return selectDiverseChunks(ranked)
    .slice(0, MATCH_COUNT)
    .map(({ chunk, score }) => ({ ...chunk, similarity: score }));
}

export function buildContextBlock(chunks: KnowledgeChunk[]): string {
  if (chunks.length === 0) return "";

  return chunks
    .map((chunk, index) => {
      const title = sourceTitle(chunk);
      const url =
        typeof chunk.metadata?.page_url === "string"
          ? chunk.metadata.page_url
          : typeof chunk.metadata?.source_url === "string"
            ? chunk.metadata.source_url
            : "";
      const source = [title, url].filter(Boolean).join(" | ");
      return `Context ${index + 1}${source ? ` [Source: ${source}]` : ""}:\n${chunk.content.slice(0, MAX_CHUNK_CONTEXT_CHARS)}`;
    })
    .join("\n\n")
    .slice(0, MAX_CONTEXT_CHARS);
}

async function fetchActiveChunks(): Promise<KnowledgeChunk[]> {
  const supabase = createServiceClient();
  const allChunks: SearchableChunk[] = [];

  for (let from = 0; from < MAX_CANDIDATES; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("knowledge_chunks")
      .select(
        "id, source_id, chunk_index, content, metadata, knowledge_sources!inner(title, source_type, source_url, status)"
      )
      .eq("knowledge_sources.status", "active")
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      console.error("[rag] failed to load active chunks", {
        code: error.code,
        message: error.message,
      });
      return [];
    }

    const page = (data ?? []) as unknown as SearchableChunk[];
    allChunks.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  if (allChunks.length === MAX_CANDIDATES) {
    console.warn("[rag] candidate limit reached", { limit: MAX_CANDIDATES });
  }

  return allChunks.map((chunk) => {
    const source = Array.isArray(chunk.knowledge_sources)
      ? chunk.knowledge_sources[0]
      : chunk.knowledge_sources;

    return {
      id: chunk.id,
      source_id: chunk.source_id,
      chunk_index: chunk.chunk_index,
      content: chunk.content,
      metadata: {
        ...chunk.metadata,
        title: source?.title ?? chunk.metadata?.title,
        source_type: source?.source_type ?? chunk.metadata?.source_type,
        source_url: source?.source_url ?? chunk.metadata?.source_url,
      },
    };
  });
}

function searchableText(chunk: KnowledgeChunk): string {
  return [
    sourceTitle(chunk),
    pageTitle(chunk),
    chunk.metadata?.source_type,
    chunk.content,
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ");
}

function sourceTitle(chunk: KnowledgeChunk): string {
  return typeof chunk.metadata?.title === "string" ? chunk.metadata.title : "";
}

function pageTitle(chunk: KnowledgeChunk): string {
  return typeof chunk.metadata?.page_title === "string"
    ? chunk.metadata.page_title
    : "";
}

function isConfidentMatch(top: RankedChunk, queryTokenCount: number): boolean {
  if (top.exactPhrase) return true;
  if (queryTokenCount === 1) {
    return top.matchedTokens === 1 && top.score >= 1;
  }
  if (top.matchedTokens < 2) return false;
  return top.coverage >= 0.45 && top.passageCoverage >= 0.45 && top.score >= 2;
}

function bestPassageCoverage(content: string, queryTokens: string[]): number {
  const passages = content
    .split(/(?<=[.!?])\s+|\n{2,}/)
    .filter((passage) => !/\bfigure\s+\d/i.test(passage));
  let best = 0;

  for (const passage of passages) {
    const tokens = new Set(tokenizeSearchText(passage));
    const matches = queryTokens.filter((queryToken) =>
      Array.from(tokens).some((token) => searchTokensMatch(queryToken, token))
    ).length;
    best = Math.max(best, matches / queryTokens.length);
  }

  return best;
}

function selectDiverseChunks(ranked: RankedChunk[]): RankedChunk[] {
  const selected: RankedChunk[] = [];

  for (const candidate of ranked) {
    const duplicate = selected.some(
      ({ chunk }) => contentSimilarity(chunk.content, candidate.chunk.content) > 0.82
    );
    if (!duplicate) selected.push(candidate);
    if (selected.length >= MATCH_COUNT) break;
  }

  return selected;
}

function contentSimilarity(left: string, right: string): number {
  const leftTokens = new Set(tokenizeSearchText(left));
  const rightTokens = new Set(tokenizeSearchText(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection++;
  }

  const union = new Set([...leftTokens, ...rightTokens]).size;
  return intersection / union;
}

function isLowQualityChunk(content: string): boolean {
  const lower = content.toLowerCase();
  const sectionReferences = lower.match(/\bsection\s+\d+/g)?.length ?? 0;
  const urlCount = lower.match(/https?:\/\//g)?.length ?? 0;
  const substantiveAtAGlance = hasSubstantiveAtAGlance(content);

  return (
    (lower.includes("table of contents") && !substantiveAtAGlance) ||
    (sectionReferences >= 4 && !substantiveAtAGlance) ||
    (lower.includes("references") && urlCount >= 5) ||
    urlCount >= 12 ||
    lower.split(/\s+/).length < 12
  );
}

function hasSubstantiveAtAGlance(content: string): boolean {
  const lower = content.toLowerCase();
  return (
    lower.includes("at a glance") &&
    lower.includes("particulate pollution remains") &&
    lower.length >= 1_000
  );
}
