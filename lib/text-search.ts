const SEARCH_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "air",
  "be",
  "base",
  "can",
  "compare",
  "compared",
  "comparison",
  "current",
  "do",
  "does",
  "did",
  "explain",
  "for",
  "from",
  "give",
  "has",
  "have",
  "how",
  "in",
  "information",
  "is",
  "it",
  "knowledge",
  "main",
  "me",
  "much",
  "of",
  "on",
  "over",
  "please",
  "say",
  "says",
  "story",
  "stories",
  "tell",
  "that",
  "the",
  "their",
  "there",
  "this",
  "thing",
  "things",
  "to",
  "versus",
  "vs",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "with",
  "would",
  "you",
  "your",
]);

const TOKEN_ALIASES: Record<string, string> = {
  concentrations: "concentration",
  countries: "country",
  cities: "city",
  changed: "change",
  changes: "change",
  changing: "change",
  increased: "increase",
  increasing: "increase",
  increases: "increase",
  higher: "increase",
  rise: "increase",
  rises: "increase",
  rising: "increase",
  rose: "increase",
  grew: "increase",
  growth: "increase",
  polluted: "pollution",
  pollutants: "pollution",
  highlights: "highlight",
  reports: "report",
  summaries: "summary",
  wildfires: "wildfire",
  trend: "change",
  trends: "change",
  trens: "change",
  states: "state",
  unitedstates: "unitedstate",
  webpages: "website",
  websites: "website",
};

const CORRECTION_TERMS = [
  "asia",
  "annual",
  "bangladesh",
  "canada",
  "change",
  "china",
  "contact",
  "explain",
  "fire",
  "global",
  "highlight",
  "increase",
  "india",
  "methodology",
  "nepal",
  "pakistan",
  "pollution",
  "report",
  "south",
  "summary",
  "overview",
  "glance",
  "trend",
  "united",
  "state",
  "unitedstate",
  "website",
  "wild",
  "wildfire",
] as const;

export function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/wild\s+fires?/g, " wildfire ")
    .replace(
      /\bu\s*\.?\s*s\s*\.?\b|\busa\b|\bunited\s+states\b/g,
      " united states unitedstates "
    )
    .replace(/pm\s*2\s*\.?\s*5|pm2\s*\.?\s*5/g, " pm25 pollution ")
    .replace(/air\s+quality\s+life\s+index/g, " aqli ")
    .replace(/south\s+asia/g, " south asia southasia ")
    .replace(
      /\b(?:highlights?|summary|summaries|overview|stor(?:y|ies))\b/g,
      " summary glance "
    )
    .replace(
      /(?:fine\s+)?particulate\s+(?:matter|pollution|concentrations?|levels?)/g,
      " pm25 pollution "
    )
    .replace(
      /more\s+than|greater\s+than|higher\s+than|up\s+from/g,
      " change increase "
    )
    .replace(
      /\b(?:increase|increased|increasing|increases|rise|rises|rising|rose|grew|growth)\b/g,
      " change increase "
    )
    .replace(
      /\b(?:decrease|decreased|decreasing|decreases|decline|declined|declining|fell|falling|lower)\b/g,
      " change decrease "
    )
    .replace(/\b(?:trend|trends|change|changed|changes|changing)\b/g, " change ")
    .replace(/[^a-z0-9%\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizeSearchText(value: string): string[] {
  return Array.from(new Set(tokenizeSearchTextAll(value)));
}

export function tokenizeSearchTextAll(value: string): string[] {
  let tokens = normalizeSearchText(value)
    .split(" ")
    .map(canonicalizeToken)
    .filter(
      (token) =>
        (token.length > 2 || /^\d+$/.test(token)) &&
        !SEARCH_STOP_WORDS.has(token)
    );

  if (tokens.includes("wild") && tokens.includes("fire")) {
    tokens = tokens.filter((token) => token !== "wild" && token !== "fire");
    tokens.push("wildfire");
  }

  if (tokens.includes("south") && tokens.includes("asia")) {
    tokens.push("southasia");
  }

  if (tokens.includes("united") && tokens.includes("state")) {
    tokens.push("unitedstate");
  }

  return tokens;

}

export function extractNumberTokens(value: string): string[] {
  return Array.from(
    new Set(
      value
        .match(/\b\d{4}\b|\b\d+(?:[.,]\d+)?%?/g)
        ?.map((number) => number.replace(/,/g, "")) ?? []
    )
  );
}

export function tokenOverlap(left: string, right: string): number {
  const leftTokens = tokenizeSearchText(left);
  if (leftTokens.length === 0) return 0;

  const rightTokens = new Set(tokenizeSearchText(right));
  const matches = leftTokens.filter((token) => rightTokens.has(token)).length;
  return matches / leftTokens.length;
}

export function searchTokensMatch(left: string, right: string): boolean {
  if (left === right) return true;
  if (left.length < 5 || right.length < 5) return false;
  const maxDistance = Math.max(left.length, right.length) >= 9 ? 2 : 1;
  return damerauLevenshtein(left, right, maxDistance) <= maxDistance;
}

function canonicalizeToken(token: string): string {
  const corrected = correctKnownToken(token);
  if (TOKEN_ALIASES[corrected]) return TOKEN_ALIASES[corrected];

  if (corrected.length > 5 && corrected.endsWith("ies")) {
    return `${corrected.slice(0, -3)}y`;
  }

  if (
    corrected.length > 5 &&
    corrected.endsWith("s") &&
    !corrected.endsWith("ss") &&
    !corrected.endsWith("sis")
  ) {
    return corrected.slice(0, -1);
  }

  return corrected;
}

function correctKnownToken(token: string): string {
  if (
    TOKEN_ALIASES[token] ||
    (CORRECTION_TERMS as readonly string[]).includes(token)
  ) {
    return token;
  }
  if (token.length < 4) return token;

  const maxDistance = token.length >= 9 ? 2 : 1;
  const matches = CORRECTION_TERMS
    .map((candidate) => ({
      candidate,
      distance: damerauLevenshtein(token, candidate, maxDistance),
    }))
    .filter(({ distance }) => distance <= maxDistance)
    .sort((left, right) => left.distance - right.distance);

  if (matches.length === 0) return token;
  if (matches.length > 1 && matches[0].distance === matches[1].distance) {
    return token;
  }
  return matches[0].candidate;
}

function damerauLevenshtein(
  left: string,
  right: string,
  maxDistance: number
): number {
  if (Math.abs(left.length - right.length) > maxDistance) {
    return maxDistance + 1;
  }

  const matrix = Array.from({ length: left.length + 1 }, () =>
    new Array<number>(right.length + 1).fill(0)
  );
  for (let row = 0; row <= left.length; row++) matrix[row][0] = row;
  for (let column = 0; column <= right.length; column++) matrix[0][column] = column;

  for (let row = 1; row <= left.length; row++) {
    let rowMinimum = maxDistance + 1;
    for (let column = 1; column <= right.length; column++) {
      const substitutionCost =
        left[row - 1] === right[column - 1] ? 0 : 1;
      matrix[row][column] = Math.min(
        matrix[row - 1][column] + 1,
        matrix[row][column - 1] + 1,
        matrix[row - 1][column - 1] + substitutionCost
      );

      if (
        row > 1 &&
        column > 1 &&
        left[row - 1] === right[column - 2] &&
        left[row - 2] === right[column - 1]
      ) {
        matrix[row][column] = Math.min(
          matrix[row][column],
          matrix[row - 2][column - 2] + 1
        );
      }
      rowMinimum = Math.min(rowMinimum, matrix[row][column]);
    }
    if (rowMinimum > maxDistance) return maxDistance + 1;
  }

  return matrix[left.length][right.length];
}
