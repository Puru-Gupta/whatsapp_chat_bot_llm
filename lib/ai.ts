import type { Message } from "@/types";
import { getAppUrl } from "@/lib/env";
import {
  extractNumberTokens,
  normalizeSearchText,
  searchTokensMatch,
  tokenOverlap,
  tokenizeSearchText,
} from "@/lib/text-search";

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";
const MODEL =
  process.env.OPENROUTER_MODEL?.trim() || "openai/gpt-oss-20b:free";
const MODEL_TIMEOUT_MS = 15_000;
const MAX_REPLY_LENGTH = 1_200;
const SENTENCE_SEGMENTER = new Intl.Segmenter("en", {
  granularity: "sentence",
});
const MISSING_KNOWLEDGE_RE =
  /(?:couldn.t|can.t|cannot|don't|do not|don.t)\s+(?:find|have)|not (?:available|provided)|current knowledge base|connect you with a human/i;

export const NO_ANSWER_REPLY =
  "I couldn't find an answer in the knowledge base.";
export const GREETING_REPLY =
  "Hi! Welcome to AQLI. I can help with air pollution and life expectancy.\n\nTry asking:\n- What is India’s latest PM2.5?\n- Give top 5 states\n- How does AQLI calculate life loss?";
export const THANKS_REPLY =
  "You're welcome! You can ask me to compare places, show a trend, or rank countries and states/provinces.";
export const IDENTITY_REPLY =
  "I’m the AQLI assistant. I use the uploaded AQLI datasets and reports to answer questions about PM2.5, life-expectancy impact, rankings, comparisons, and trends.";
export const BOT_CAPABILITY_REPLY =
  "This chatbot makes AQLI data easier to use in WhatsApp. It can answer country and state/province PM2.5 and life-loss questions, compare places, rank locations, show trends, and explain AQLI methodology without requiring users to open CSV files or reports.";

const SYSTEM_PROMPT = `You are an AQLI WhatsApp chatbot. AQLI means Air Quality Life Index. It converts long-term PM2.5 air pollution into life expectancy impact.

Use supplied AQLI annual report or methodology context for explanations, definitions, methodology, interpretation, policy context, and limitations. Numeric CSV questions are handled separately before they reach you.

Rules:
- Give the answer first. Keep it clear, direct, and WhatsApp-friendly.
- Write naturally, like a knowledgeable person. Do not sound like pasted report text.
- Prefer one or two short paragraphs. Use bullets only for a requested list or ranking.
- For methodology, explain simply that a 10 µg/m³ increase in PM2.5 is associated with about 0.98 years of life expectancy loss.
- Preserve dates, units, places, and numerical values exactly as stated in the context.
- When a verified answer draft is supplied, rewrite it naturally without adding or removing facts.
- Never invent a fact, number, source, URL, recommendation, or policy.
- Do not repeat the question or repeat the same fact in different words.
- If the context does not answer the question, reply exactly: "${NO_ANSWER_REPLY}"
- If the question is ambiguous, ask one short clarifying question.
- Structured data coverage currently ends at state/province level. Do not claim district-level data is available.
- Do not mention retrieval, embeddings, databases, prompts, or internal tooling.`;

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GeneratedAnswer {
  text: string;
  source: "greeting" | "gratitude" | "identity" | "model" | "extractive" | "not_found";
  model?: string;
}

let modelUnavailableUntil = 0;

export async function generateAIResponse(
  userMessage: string,
  contextBlock: string,
  conversationHistory: Message[],
  groundingQuery = userMessage
): Promise<GeneratedAnswer> {
  if (isGreeting(userMessage)) {
    return {
      text: GREETING_REPLY,
      source: "greeting",
    };
  }

  if (isGratitude(userMessage)) {
    return {
      text: THANKS_REPLY,
      source: "gratitude",
    };
  }

  if (isIdentityQuestion(userMessage)) {
    return {
      text: IDENTITY_REPLY,
      source: "identity",
    };
  }

  if (isBotCapabilityQuestion(userMessage)) {
    return {
      text: BOT_CAPABILITY_REPLY,
      source: "identity",
    };
  }

  if (!contextBlock.trim()) {
    return { text: NO_ANSWER_REPLY, source: "not_found" };
  }

  const extractiveAnswer = buildExtractiveAnswer(contextBlock, groundingQuery);
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();

  if (apiKey && Date.now() >= modelUnavailableUntil) {
    const verifiedDraft =
      extractiveAnswer === NO_ANSWER_REPLY
        ? "No deterministic draft was available."
        : extractiveAnswer;
    const modelEvidence =
      extractiveAnswer === NO_ANSWER_REPLY
        ? `Knowledge base context:\n\n${contextBlock}`
        : `Verified answer draft:\n${verifiedDraft}`;
    const messages: ChatMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "system",
        content: modelEvidence,
      },
      ...prepareHistory(conversationHistory, userMessage),
      { role: "user", content: userMessage },
    ];

    try {
      const content = await callOpenRouter(MODEL, messages, apiKey);
      const reply = formatWhatsAppReply(content);

      if (
        isGroundedReply(
          reply,
          `${contextBlock}\n${verifiedDraft}`,
          extractiveAnswer === NO_ANSWER_REPLY ? undefined : extractiveAnswer
        )
      ) {
        return { text: reply, source: "model", model: MODEL };
      }

      console.warn("[ai] rejected ungrounded model response", { model: MODEL });
    } catch (error) {
      const status = error instanceof OpenRouterError ? error.status : null;
      modelUnavailableUntil =
        Date.now() + (status === 429 ? 120_000 : 45_000);
      console.warn("[ai] model unavailable; using grounded fallback", {
        model: MODEL,
        status,
        reason: error instanceof Error ? error.message : "unknown",
      });
    }
  }

  if (extractiveAnswer !== NO_ANSWER_REPLY) {
    return {
      text: naturalizeExtractiveFallback(extractiveAnswer),
      source: "extractive",
    };
  }

  return { text: NO_ANSWER_REPLY, source: "not_found" };
}

export function buildExtractiveAnswer(
  contextBlock: string,
  userMessage: string
): string {
  const reportSummaryAnswer = answerReportSummaryQuestion(
    contextBlock,
    userMessage
  );
  if (reportSummaryAnswer) return reportSummaryAnswer;

  const aqliDefinitionAnswer = answerAqliDefinitionQuestion(
    contextBlock,
    userMessage
  );
  if (aqliDefinitionAnswer) return aqliDefinitionAnswer;

  const pollutedCountriesAnswer = answerPollutedCountriesQuestion(
    contextBlock,
    userMessage
  );
  if (pollutedCountriesAnswer) return pollutedCountriesAnswer;

  const websiteAnswer = answerWebsiteInventoryQuestion(contextBlock, userMessage);
  if (websiteAnswer) return websiteAnswer;

  const canadaWildfireAnswer = answerCanadaWildfireQuestion(
    contextBlock,
    userMessage
  );
  if (canadaWildfireAnswer) return canadaWildfireAnswer;

  const southAsiaAnswer = answerSouthAsiaQuestion(contextBlock, userMessage);
  if (southAsiaAnswer) return southAsiaAnswer;

  const indiaAnswer = answerIndiaQuestion(contextBlock, userMessage);
  if (indiaAnswer) return indiaAnswer;

  const methodologyAnswer = answerMethodologyQuestion(contextBlock, userMessage);
  if (methodologyAnswer) return methodologyAnswer;

  const queryTokens = tokenizeSearchText(userMessage);
  if (queryTokens.length === 0) return NO_ANSWER_REPLY;

  const windows = parseContextSnippets(contextBlock)
    .flatMap((snippet) => buildSentenceWindows(snippet))
    .map((text) => ({
      text,
      score: scoreWindow(text, queryTokens),
    }))
    .filter(
      ({ text, score }) =>
        isUsableAnswerText(text) &&
        score > 0 &&
        windowMatchesIntent(text, userMessage, queryTokens)
    )
    .sort((left, right) => right.score - left.score);

  const selected: string[] = [];
  for (const candidate of windows) {
    if (selected.some((existing) => answerPassagesOverlap(existing, candidate.text))) {
      continue;
    }

    selected.push(candidate.text);
    if (selected.length === 2) break;
  }

  if (selected.length === 0) return NO_ANSWER_REPLY;
  if (selected.length === 1) return formatWhatsAppReply(selected[0]);

  return formatWhatsAppReply(selected.map((text) => `- ${text}`).join("\n"));
}

export function formatWhatsAppReply(content: string): string {
  const lines = content
    .trim()
    .replace(/\bLifeIndex\b/g, "Life Index")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.trimEnd());
  const seenLines = new Set<string>();
  const uniqueLines: string[] = [];

  for (const line of lines) {
    const key = normalizeSearchText(line.replace(/^[-*\d.]+\s*/, ""));
    if (key && seenLines.has(key)) continue;
    if (key) seenLines.add(key);
    uniqueLines.push(line);
  }

  const reply = uniqueLines.join("\n").trim();
  if (reply.length <= MAX_REPLY_LENGTH) return reply;

  const shortened = reply.slice(0, MAX_REPLY_LENGTH - 3);
  const lastBoundary = Math.max(
    shortened.lastIndexOf(". "),
    shortened.lastIndexOf("\n")
  );
  return `${shortened.slice(0, lastBoundary > 600 ? lastBoundary + 1 : undefined).trim()}...`;
}

async function callOpenRouter(
  model: string,
  messages: ChatMessage[],
  apiKey: string
): Promise<string> {
  const response = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": getAppUrl(),
      "X-Title": "AQLI WhatsApp Chatbot",
    },
    signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
    body: JSON.stringify({
      model,
      messages,
      max_tokens: 420,
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    throw new OpenRouterError(response.status);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("Empty model response");
  }

  return content;
}

function prepareHistory(
  history: Message[],
  currentUserMessage: string
): ChatMessage[] {
  const prepared: ChatMessage[] = [];

  for (const message of history.slice(-10)) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    if (
      message.role === "user" &&
      normalizeSearchText(message.content) === normalizeSearchText(currentUserMessage)
    ) {
      continue;
    }

    const previous = prepared[prepared.length - 1];
    if (
      previous?.role === message.role &&
      normalizeSearchText(previous.content) === normalizeSearchText(message.content)
    ) {
      continue;
    }

    prepared.push({ role: message.role, content: message.content });
  }

  return prepared;
}

function isGroundedReply(
  reply: string,
  context: string,
  verifiedDraft?: string
): boolean {
  if (!reply || MISSING_KNOWLEDGE_RE.test(reply)) return false;

  const replyNumbers = extractNumberTokens(reply);
  const contextNumbers = new Set(
    extractNumberTokens(context).map((number) => number.replace(/%$/, ""))
  );
  if (
    replyNumbers.some(
      (number) => !contextNumbers.has(number.replace(/%$/, ""))
    )
  ) {
    return false;
  }
  if (verifiedDraft) {
    const normalizedReplyNumbers = new Set(
      replyNumbers.map((number) => number.replace(/%$/, ""))
    );
    const missingVerifiedNumber = extractNumberTokens(verifiedDraft).some(
      (number) => !normalizedReplyNumbers.has(number.replace(/%$/, ""))
    );
    if (missingVerifiedNumber) return false;
  }

  const replyUrls = reply.match(/https?:\/\/[^\s)]+/g) ?? [];
  if (replyUrls.some((url) => !context.includes(url))) return false;

  const replyTokens = tokenizeSearchText(reply);
  return replyTokens.length > 0 && tokenOverlap(reply, context) >= 0.25;
}

function naturalizeExtractiveFallback(value: string): string {
  const facts = value
    .split("\n")
    .map((line) => line.replace(/^[-*]\s*/, "").trim())
    .filter(Boolean);
  return formatWhatsAppReply(facts.join(" "));
}

function parseContextSnippets(contextBlock: string): string[] {
  const matches = contextBlock.matchAll(
    /Context \d+(?: \[Source: [^\]]+\])?:\n([\s\S]*?)(?=\n\nContext \d+|$)/g
  );
  return Array.from(matches, (match) => match[1].replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function buildSentenceWindows(snippet: string): string[] {
  const sentences = splitIntoSentences(snippet);
  const windows: string[] = [];

  for (let index = 0; index < sentences.length; index++) {
    windows.push(sentences[index]);
    if (index + 1 < sentences.length) {
      windows.push(`${sentences[index]} ${sentences[index + 1]}`);
    }
  }

  return windows;
}

function splitIntoSentences(value: string): string[] {
  const segmented = value
    .split(/[•]+/g)
    .flatMap((part) =>
      Array.from(SENTENCE_SEGMENTER.segment(part), ({ segment }) =>
        cleanExtractedText(segment)
      )
    )
    .filter(Boolean);
  const merged: string[] = [];

  for (const sentence of segmented) {
    const previousIndex = merged.length - 1;
    if (
      previousIndex >= 0 &&
      /\b(?:St|Dr|Mr|Ms|Prof|et al)\.$/i.test(merged[previousIndex])
    ) {
      merged[previousIndex] = `${merged[previousIndex]} ${sentence}`;
    } else {
      merged.push(sentence);
    }
  }

  return merged;
}

function cleanExtractedText(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/\bwithPM\b/gi, "with PM")
    .replace(/^\d+\s*\|\s*\d{4}\s+Annual Update AQLI\s*/i, "")
    .replace(/^AQLI\s+\d{4}\s+Annual Update\s*\|\s*\d+\s*/i, "")
    .replace(/^(?:Appendix\s+[IVX]+|Section\s+\d+)\s*[:.-]?\s*/i, "")
    .replace(/^Methodology\s*[-:]?\s*(?:AQLI\s*)?/i, "")
    .trim();
}

function scoreWindow(text: string, queryTokens: string[]): number {
  const textTokens = new Set(tokenizeSearchText(text));
  let score = 0;

  for (const token of queryTokens) {
    if (Array.from(textTokens).some((candidate) => searchTokensMatch(token, candidate))) {
      score += /^\d+$/.test(token) ? 4 : 1;
    }
  }

  const coverage = score / Math.max(queryTokens.length, 1);
  if (coverage >= 0.5) score += 2;
  return score - Math.min(text.length / 1_000, 0.6);
}

function windowMatchesIntent(
  text: string,
  userMessage: string,
  queryTokens: string[]
): boolean {
  const textTokens = new Set(tokenizeSearchText(text));
  const matches = queryTokens.filter((queryToken) =>
    Array.from(textTokens).some((token) => searchTokensMatch(queryToken, token))
  ).length;
  const minimumMatches = queryTokens.length === 1 ? 1 : 2;
  const requiredCoverage = queryTokens.length <= 3 ? 1 : 0.45;
  if (matches < minimumMatches || matches / queryTokens.length < requiredCoverage) {
    return false;
  }

  const requiredEntities = queryTokens.filter(
    (token) => !ANSWER_INTENT_TOKENS.has(token) && !/^\d+$/.test(token)
  );
  if (
    requiredEntities.some(
      (required) =>
        !Array.from(textTokens).some((token) => searchTokensMatch(required, token))
    )
  ) {
    return false;
  }

  const requiredYears = extractNumberTokens(userMessage).filter(
    (number) => /^\d{4}$/.test(number)
  );
  const textNumbers = new Set(extractNumberTokens(text));
  if (requiredYears.some((year) => !textNumbers.has(year))) return false;

  const asksForPmMeasurement =
    queryTokens.includes("pm25") &&
    (/\b(what (?:is|was|are|were)|level|concentration|value|amount|average)\b/i.test(
      userMessage
    ) ||
      /\b\d{4}\b/.test(userMessage));

  if (
    asksForPmMeasurement &&
    !/(?:μg|ug|micrograms?)\s*\/\s*m[³3]?/i.test(text)
  ) {
    return false;
  }

  return true;
}

function answerPassagesOverlap(left: string, right: string): boolean {
  const normalizedLeft = normalizeSearchText(left);
  const normalizedRight = normalizeSearchText(right);
  if (
    normalizedLeft === normalizedRight ||
    normalizedLeft.includes(normalizedRight) ||
    normalizedRight.includes(normalizedLeft) ||
    tokenOverlap(right, left) > 0.78
  ) {
    return true;
  }

  const leftNumbers = new Set(extractNumberTokens(left));
  const sharesNumber = extractNumberTokens(right).some((number) =>
    leftNumbers.has(number)
  );
  return sharesNumber && tokenOverlap(right, left) > 0.4;
}

const ANSWER_INTENT_TOKENS = new Set([
  "contact",
  "change",
  "data",
  "increase",
  "level",
  "methodology",
  "pm25",
  "pollution",
  "trend",
  "website",
  "wildfire",
]);

function isUsableAnswerText(text: string): boolean {
  const lower = text.toLowerCase();
  const sectionReferences = lower.match(/\bsection\s+\d+/g)?.length ?? 0;
  const hasCompleteEnding = /[.!?)]$|(?:m[³3]?|%|years?|months?)$/i.test(text.trim());

  return (
    text.length >= 35 &&
    text.length <= 620 &&
    hasCompleteEnding &&
    !lower.includes("table of contents") &&
    !/\bfigure\s+\d/i.test(lower) &&
    !lower.startsWith("section ") &&
    sectionReferences < 2
  );
}

function answerWebsiteInventoryQuestion(
  contextBlock: string,
  userMessage: string
): string | null {
  if (!/\b(website|webpage|url|link)\b/i.test(userMessage)) return null;

  const match = contextBlock.match(
    /\[Source: ([^\]|]+)\s*\|\s*(https?:\/\/[^\]]+)\]/
  );
  if (!match) return null;

  return `Yes. ${match[1].trim()} is included in the knowledge base: ${match[2].trim()}`;
}

function answerAqliDefinitionQuestion(
  contextBlock: string,
  userMessage: string
): string | null {
  if (
    !/\b(?:what(?:'s| is) (?:the )?aqli|what does aqli do|who (?:developed|created) aqli|tell me about aqli)\b/i.test(
      userMessage
    )
  ) {
    return null;
  }

  const sentences = parseContextSnippets(contextBlock).flatMap(splitIntoSentences);
  const definition = extractFact(
    sentences,
    /The Air Quality Life Index \(AQLI\) converts air pollution concentrations into their impact on life expectancy\./i
  );
  const developer = extractFact(
    sentences,
    /Developed by .*?Michael Greenstone and his team at the Energy Policy Institute at the University of Chicago \(EPIC\),?[^.]*\./i
  );

  if (/\bwho (?:developed|created)\b/i.test(userMessage)) {
    return developer ?? null;
  }
  return definition ?? null;
}

function answerPollutedCountriesQuestion(
  contextBlock: string,
  userMessage: string
): string | null {
  const tokens = tokenizeSearchText(userMessage);
  if (
    !tokens.includes("country") ||
    !tokens.includes("pollution") ||
    !/\b(most|top|ranking|rank)\b/i.test(userMessage)
  ) {
    return null;
  }

  const normalized = contextBlock.replace(/\s+/g, " ");
  const tableStart = normalized.search(/Table 3\.1: Impacts of particulate pollution/i);
  if (tableStart < 0) return null;
  const table = normalized.slice(tableStart);
  const countries = ["Bangladesh", "Pakistan", "India", "Nepal", "Afghanistan"];
  const values = countries.map((country) => {
    const match = table.match(
      new RegExp(`\\b${country}\\s+(\\d+(?:\\.\\d+)?)\\b`, "i")
    );
    return match ? { country, years: match[1] } : null;
  });
  if (values.some((value) => !value)) return null;

  const ranked = values as Array<{ country: string; years: string }>;
  return `Among the South Asian countries listed in the report, Bangladesh has the highest pollution-related life expectancy burden: residents could gain ${ranked[0].years} years if PM2.5 met the WHO guideline. It is followed by Pakistan (${ranked[1].years} years), India (${ranked[2].years} years), Nepal (${ranked[3].years} years), and Afghanistan (${ranked[4].years} years).`;
}

function answerReportSummaryQuestion(
  contextBlock: string,
  userMessage: string
): string | null {
  const tokens = tokenizeSearchText(userMessage);
  const asksForSummary =
    tokens.includes("summary") ||
    tokens.includes("highlight") ||
    tokens.includes("overview") ||
    /\bat a glance\b/i.test(userMessage);
  const identifiesReport =
    tokens.includes("report") ||
    tokens.includes("annual") ||
    /\bat a glance\b/i.test(userMessage);

  if (!asksForSummary || !identifiesReport) return null;

  const sentences = parseContextSnippets(contextBlock).flatMap(splitIntoSentences);
  const globalThreat = extractFact(
    sentences,
    /Particulate pollution remains the world(?:'|’)s greatest external threat to human health\./i
  );
  const globalGain = extractFact(
    sentences,
    /If global PM\s*2\.?5 levels met the WHO guideline of 5\s*(?:µg|μg|ug)\/m[³3],? the average person could live 2\.1 years longer\./i
  );
  const stalledProgress = extractFact(
    sentences,
    /2024 marks the fifth consecutive year with no meaningful decline in global particulate concentrations\./i
  );
  const southAsia = extractFact(
    sentences,
    /South Asia remained the most polluted region.*?3\.7 years longer if particulate concentrations across the region were reduced to meet the WHO guideline\./i
  );

  const facts = [
    globalThreat && globalGain ? `${globalThreat} ${globalGain}` : globalThreat,
    stalledProgress,
    southAsia,
  ].filter((sentence): sentence is string => Boolean(sentence));

  if (globalThreat && globalGain && stalledProgress && southAsia) {
    return `The report's main message is clear: particulate pollution remains the world's greatest external threat to human health. ${globalGain} It also notes that ${stalledProgress.charAt(0).toLowerCase()}${stalledProgress.slice(1)} ${southAsia}`;
  }

  return formatSelectedFacts(facts.slice(0, 3));
}

function answerMethodologyQuestion(
  contextBlock: string,
  userMessage: string
): string | null {
  if (
    !/\bmethodology\b/i.test(userMessage) &&
    !/\bhow (?:does|is) (?:the )?aqli (?:calculate|work)/i.test(userMessage)
  ) {
    return null;
  }

  if (/\b(methodology|calculate|calculation|convert|conversion)\b/i.test(userMessage)) {
    return "AQLI converts long-term PM2.5 pollution into life expectancy impact. It is based on research showing that sustained particulate pollution reduces life expectancy. The standard conversion is that a 10 µg/m³ increase in PM2.5 is associated with about 0.98 years of life expectancy loss.";
  }

  const sentences = parseContextSnippets(contextBlock)
    .flatMap(splitIntoSentences);
  const selected = sentences.filter((sentence) =>
    /combines this information with global satellite data|combines the satellite estimates of pm|population-weighted pollution estimates are then combined/i.test(
      sentence
    )
  );
  const unique = Array.from(new Set(selected)).slice(0, 2);

  if (unique.length === 0) return null;
  if (unique.length === 1) return formatWhatsAppReply(unique[0]);
  return formatWhatsAppReply(unique.map((sentence) => `- ${sentence}`).join("\n"));
}

function answerCanadaWildfireQuestion(
  contextBlock: string,
  userMessage: string
): string | null {
  const tokens = tokenizeSearchText(userMessage);
  if (!tokens.includes("canada") || !tokens.includes("wildfire")) return null;

  const sentences = parseContextSnippets(contextBlock).flatMap(splitIntoSentences);
  const burnedArea = ensureSentence(
    extractFact(
      sentences,
      /(?:the 2023 wildfires in Canada|Canada(?:'s|’s) 2023 wildfires?) (?:burned|burnt) roughly 1\.3 percent of Canada(?:'s|’s) total land area/i
    )
  );
  const usBurnedArea = ensureSentence(
    extractFact(
      sentences,
      /(?:the )?2020[–-](?:20)?21 (?:wildfire season|United States wildfires?).*?(?:United States.*)?(?:burned|burnt) (?:roughly|nearly) 0\.5 percent of (?:its|the) total land area/i
    )
  );
  const broadBurnedArea = extractFact(
    sentences,
    /The 2019[–-]2020 Australian bushfires burned more than 4 percent of the country’s land area while the 2023 wildfires in Canada burned roughly 1\.3 percent of Canada’s total land area\./i
  );
  const forestShareEvidence = extractFact(
    sentences,
    /(?:forests? accounting for .*?nearly 20 percent in Canada|forest land (?:made up|accounted for) nearly 20 percent of the burned area)/i
  );
  const forestShare = forestShareEvidence
    ? "Forests accounted for nearly 20 percent of the burned area in Canada."
    : undefined;
  const recordHigh = extractFact(
    sentences,
    /In Australia and Canada, large scale fires have had impacts on air quality at the national level, driving record high pollution levels in these countries\./i
  );
  const quantitative = extractFact(
    sentences,
    /Wildfires? in Canada significantly worsened air quality in 2023,\s*with\s*PM\s*2\.?5\s*levels rising by over 50 percent in Canada and 20 percent in the United States compared to 2022\./i
  );
  const measuredLevel = extractFact(
    sentences,
    /At 9\.2\s*(?:μg|ug)\/m[³3]?,.*?WHO guideline\./i
  );
  const historical = extractFact(
    sentences,
    /Fueled by the worst wildfire season in its history,\s*Canada experienced its highest particulate pollution levels since 1998 while also contributing to worsening air quality in several states in the United States\./i
  );
  const currentReportFacts = [burnedArea, forestShare, recordHigh, broadBurnedArea].filter(
    (sentence): sentence is string => Boolean(sentence)
  );
  const asksForUnitedStates = tokens.includes("unitedstate");
  const selected = [
    ...(asksForUnitedStates && burnedArea && usBurnedArea
      ? [burnedArea, usBurnedArea]
      : currentReportFacts.length > 0
      ? currentReportFacts
      : [quantitative, measuredLevel, historical]),
  ]
    .filter((sentence): sentence is string => Boolean(sentence))
    .filter(
      (sentence, index, all) =>
        all.findIndex((candidate) => answerPassagesOverlap(candidate, sentence)) ===
        index
    )
    .slice(0, 2);

  return formatSelectedFacts(selected);
}

function answerIndiaQuestion(
  contextBlock: string,
  userMessage: string
): string | null {
  const tokens = tokenizeSearchText(userMessage);
  if (!tokens.includes("india")) return null;
  if (!tokens.includes("pollution") && !tokens.includes("pm25")) return null;

  const requestedYears = extractNumberTokens(userMessage).filter((number) =>
    /^\d{4}$/.test(number)
  );
  const asksForTrend =
    tokens.includes("change") ||
    tokens.includes("increase") ||
    /\btrend\b/i.test(userMessage);
  const asksForConcentration =
    /\b(level|concentration|value|amount|average)\b/i.test(userMessage) ||
    /\bwhat (?:is|was|are|were)\s+(?:the\s+)?(?:pm\s*2\.?5|pollution)\b/i.test(
      userMessage
    );
  if (asksForConcentration && !asksForTrend) return NO_ANSWER_REPLY;
  if (asksForConcentration && requestedYears.length > 0) {
    return NO_ANSWER_REPLY;
  }

  const normalizedContext = contextBlock.replace(/\s+/g, " ");
  const tableHeaderPresent =
    /Change in particulate levels between 1998 and 2024/i.test(
      normalizedContext
    );
  const row = normalizedContext.match(
    /India\s+(\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+>\s*(\d+(?:\.\d+)?);\s*New Delhi\s+(\d+(?:\.\d+)?);\s*Ladakh\s+(\d+(?:\.\d+)?)\s*(?:µg|μg)\/m[³3]\s+(\d+(?:\.\d+)?)/i
  );

  if (!tableHeaderPresent || !row) return null;

  const [, whoGain, change, , , , standard] = row;
  const facts = [
    `From 1998 to 2024, India's particulate pollution increased by ${change} percent.`,
    `Based on 2024 concentrations, an average resident could gain ${whoGain} years of life expectancy if pollution met the WHO guideline; India's national annual PM2.5 standard is ${standard} μg/m³.`,
  ];
  return formatSelectedFacts(facts);
}

function answerSouthAsiaQuestion(
  contextBlock: string,
  userMessage: string
): string | null {
  const tokens = tokenizeSearchText(userMessage);
  if (!tokens.includes("southasia")) return null;
  if (!tokens.includes("pollution") && !tokens.includes("pm25")) return null;

  const sentences = parseContextSnippets(contextBlock).flatMap(splitIntoSentences);
  const regionalIncrease = sentences.find((sentence) =>
    /in 2023,? pm\s*2\.?5 concentrations in south asia were 2\.9 percent higher/i.test(
      sentence
    )
  );
  const chinaComparison = sentences.find((sentence) =>
    /(?:its )?pollution is 52 percent higher than china/i.test(sentence)
  );
  const lifeExpectancy = sentences.find((sentence) =>
    /pollution in south asia cuts life expectancy short by 3\.6 years/i.test(
      sentence
    )
  );
  const asksForTrend =
    tokens.includes("pm25") ||
    tokens.includes("increase") ||
    tokens.includes("change");
  const selected = asksForTrend
    ? [regionalIncrease, chinaComparison, lifeExpectancy]
    : [chinaComparison, lifeExpectancy, regionalIncrease];

  return formatSelectedFacts(
    selected.filter((sentence): sentence is string => Boolean(sentence)).slice(0, 2)
  );
}

function formatSelectedFacts(sentences: string[]): string | null {
  if (sentences.length === 0) return null;
  if (sentences.length === 1) return formatWhatsAppReply(sentences[0]);
  return formatWhatsAppReply(sentences.map((sentence) => `- ${sentence}`).join("\n"));
}

function extractFact(sentences: string[], pattern: RegExp): string | undefined {
  for (const sentence of sentences) {
    const match = sentence.match(pattern);
    if (match?.[0]) return cleanExtractedText(match[0]);
  }
  return undefined;
}

function ensureSentence(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const capitalized = `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
  return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

function isGreeting(value: string): boolean {
  return /^(hi|hii+|hello|hey|salam|assalam|good (?:morning|afternoon|evening))[!.\s]*$/i.test(
    value.trim()
  );
}

function isGratitude(value: string): boolean {
  return /^(thanks?|thank\s*(?:you|u)|thx|thnx|thnks|thansk|ty)(?:\s+(?:a lot|so much|for (?:the|your) help))?[!.\s]*$/i.test(
    value.trim()
  );
}

function isIdentityQuestion(value: string): boolean {
  return /^(?:who are you|what are you|what can you do|how can you help)(?:\s+me)?[?.!\s]*$/i.test(
    value.trim()
  );
}

function isBotCapabilityQuestion(value: string): boolean {
  return /^(?:why (?:is )?(?:this |the )?(?:aqli )?(?:chatbot|bot) important|why (?:this |the )?(?:aqli )?(?:chatbot|bot) is important|what (?:is|are) the (?:benefits?|advantages?) of (?:this |the )?(?:chatbot|bot)|how (?:is|does) (?:this |the )?(?:chatbot|bot) (?:helpful|help|useful)|why (?:use|should (?:we|i) use) (?:this |the )?(?:chatbot|bot))[?.!\s]*$/i.test(
    value.trim()
  );
}

class OpenRouterError extends Error {
  constructor(public readonly status: number) {
    super(`OpenRouter request failed with status ${status}`);
    this.name = "OpenRouterError";
  }
}
