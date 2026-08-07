import type { GeneratedAnswer } from "@/lib/ai";

export function addDocumentReference(
  answer: GeneratedAnswer,
  query: string,
  usedConversationContext: boolean
): string {
  const source = documentSource(query);
  const contextPrefix = usedConversationContext
    ? "Previous conversation context + "
    : "";

  if (
    answer.source === "greeting" ||
    answer.source === "gratitude" ||
    answer.source === "identity"
  ) {
    return `${answer.text}\n\nReference: AQLI chatbot.`;
  }

  if (answer.source === "not_found") {
    return `I don’t have enough information on that in the current annual report.\n\nReference checked: ${source}.`;
  }

  if (/\nReference(?: checked)?:/i.test(answer.text)) return answer.text;
  const suggestion = documentSuggestion(query, source);
  return `${answer.text}${suggestion ? `\n\n${suggestion}` : ""}\n\nReference: ${contextPrefix}${source}.`;
}

function documentSource(query: string): string {
  return /\b(methodology|method|calculate|calculated|calculation|formula|0\.98|life expectancy (?:loss|impact)|why (?:does )?aqli|why pm\s*2\.?5|limitation)\b/i.test(
    query
  )
    ? "AQLI Methodology document"
    : "AQLI Annual Report";
}

function documentSuggestion(query: string, source: string): string {
  if (/\b(summary|overview|at a glance)\b/i.test(query)) {
    return "You can also ask: “What does the report say about South Asia?”";
  }
  if (source.includes("Methodology")) {
    return "You can also ask: “What are AQLI’s limitations?”";
  }
  return "You can also ask: “What are the report’s main findings?”";
}
