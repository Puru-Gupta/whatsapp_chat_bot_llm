import { createServiceClient } from "@/lib/supabase/server";
import { searchTokensMatch } from "@/lib/text-search";
import {
  csvLevelLabel,
  inferCsvDatasetLevel,
  selectLatestCsvSources,
  type CsvDatasetLevel,
} from "@/lib/csv-sources";

export const CSV_NO_DATA_REPLY =
  "I don’t have enough data for that in the current CSV.";

type CsvRecord = Record<string, string>;
type GeographyLevel = "region" | "country" | "state" | "district";
type Benchmark =
  | { type: "who"; target: 5 }
  | { type: "national" }
  | { type: "custom"; target: number };

interface DataRow {
  region?: string;
  country?: string;
  state?: string;
  district?: string;
  year?: number;
  pm25?: number;
  llpp?: number;
  llppWho?: number;
  llppNational?: number;
  population?: number;
  whoStandard?: number;
  nationalStandard?: number;
  csvLevel?: CsvDatasetLevel;
  sourceFile?: string;
  usedSimpleAverage?: boolean;
}

interface LoadedCsvRecord {
  record: CsvRecord;
  level?: CsvDatasetLevel;
  sourceFile: string;
}

export interface CsvQuestionOptions {
  currentQuery?: string;
  usedConversationContext?: boolean;
}

interface PlaceTarget {
  level: GeographyLevel;
  value: string;
  matchQuality: number;
  position: number;
}

type DataIntent =
  | "ranking"
  | "comparison"
  | "trend"
  | "peak_change"
  | "peak_value"
  | "threshold_filter";

type NumericMetric =
  | "pm25"
  | "nationalStandard"
  | "whoStandard"
  | "llppWho"
  | "llppNational"
  | "population";
type NumericOperator = "lt" | "lte" | "eq" | "gte" | "gt";

interface NumericCondition {
  metric: NumericMetric;
  operator: NumericOperator;
  threshold: number;
}

type CsvDataField = Exclude<
  keyof DataRow,
  "csvLevel" | "sourceFile" | "usedSimpleAverage"
>;

const FIELD_ALIASES: Record<CsvDataField, string[]> = {
  region: ["region", "regionname", "worldregion"],
  country: ["country", "countryname", "name0", "nation"],
  state: ["state", "statename", "name1", "province", "provinceName"],
  district: ["district", "districtname", "name2", "county", "countyname"],
  year: ["year", "datayear"],
  pm25: [
    "pm25",
    "annualpm25",
    "annualaveragepm25",
    "pm25annualaverage",
    "particulatepollution",
  ],
  llpp: [
    "llpp",
    "lifelossperperson",
    "lifeloss",
    "yearslost",
    "lifeexpectancyloss",
  ],
  llppWho: [
    "llppwho",
    "llppwhoguideline",
    "lifelosswho",
    "lifelosswhoguideline",
  ],
  llppNational: [
    "llppnational",
    "llppnat",
    "llppnationalstandard",
    "lifelossnational",
    "lifelossnationalstandard",
  ],
  population: ["population", "pop", "populationcount"],
  whoStandard: [
    "whostandard",
    "whoguideline",
    "whopm25standard",
    "pm25whostandard",
  ],
  nationalStandard: [
    "nationalstandard",
    "natstandard",
    "nationalpm25standard",
    "pm25nationalstandard",
  ],
};

const LEVELS: GeographyLevel[] = ["region", "country", "state", "district"];
const PLACE_TOKEN_ALIASES: Record<string, string> = {
  mayammar: "myanmar",
  myamar: "myanmar",
  myanmmar: "myanmar",
  burma: "myanmar",
};
const NON_SOVEREIGN_GADM0_LABELS = new Set(
  [
    "american samoa", "anguilla", "aruba", "bermuda", "british virgin islands",
    "aland", "aland islands", "antarctica", "ashmore and cartier islands", "bonaire sint eustatius and saba",
    "bouvet island", "british indian ocean territory", "cayman islands", "christmas island", "clipperton island",
    "cocos islands", "cook islands", "coral sea islands territory", "curacao", "faroe islands", "falkland islands",
    "french guiana", "french polynesia", "french southern territories", "gibraltar", "greenland", "guadeloupe", "guam", "guernsey", "hong kong",
    "heard island and mcdonald islands",
    "isle of man", "jersey", "macao", "martinique", "mayotte", "montserrat", "new caledonia",
    "niue", "norfolk island", "northern mariana islands", "paracel islands", "pitcairn islands", "puerto rico", "reunion", "saint barthelemy",
    "saint helena ascension and tris", "saint helena ascension and tristan da cunha", "saint martin", "saint pierre and miquelon", "sint maarten", "south georgia and the south sandwich islands", "spratly islands", "svalbard and jan mayen",
    "tokelau", "turks and caicos islands", "united states minor outlying islands", "united states virgin islands",
    "virgin islands u s", "wallis and futuna", "western sahara",
  ]
);
const NON_PLACE_QUERY_WORDS = new Set([
  "what", "which", "where", "how", "is", "are", "was", "were", "the",
  "a", "an", "of", "in", "for", "to", "from", "with", "and", "or",
  "about", "tell", "show", "give", "me", "please", "this", "that", "it",
  "its", "same", "place", "latest", "available", "year", "years", "pm25",
  "pollution", "polluted", "level", "levels", "life", "expectancy", "loss",
  "gain", "llpp", "population", "trend", "change", "compare", "comparison",
  "difference", "rank", "ranking", "top", "bottom", "highest", "lowest",
  "best", "worst", "most", "least", "each", "all", "country", "countries",
  "state", "states", "province", "provinces", "district", "districts",
  "region", "regions", "who", "guideline", "national", "standard", "benchmark",
  "custom", "target", "using", "by", "data", "value", "values",
  "total", "list", "capital", "improvement", "improvements", "standard",
  "standards", "more", "than", "above", "below", "under", "over", "since",
]);
const CSV_CACHE_TTL_MS = 5 * 60_000;
let csvRecordCache:
  | { signature: string; records: LoadedCsvRecord[]; expiresAt: number }
  | undefined;
let csvRowCache:
  | { records: LoadedCsvRecord[]; rows: DataRow[] }
  | undefined;

export async function answerCsvQuestion(
  query: string,
  options: CsvQuestionOptions = {}
): Promise<string | null> {
  const currentQuery = options.currentQuery ?? query;
  const hasDataIntent = isCsvDataQuestion(currentQuery) || isCsvDataQuestion(query);
  const capabilityQuestion = isCsvCapabilityQuestion(currentQuery);
  const potentialPlaceQuestion = isPotentialPlaceQuestion(currentQuery);
  if (!hasDataIntent && !capabilityQuestion && !potentialPlaceQuestion) return null;

  const records = await loadActiveCsvRecords();
  if (records.length === 0) {
    return withReference(CSV_NO_DATA_REPLY, undefined, undefined, options);
  }
  if (csvRowCache?.records !== records) {
    csvRowCache = {
      records,
      rows: records
        .flatMap(({ record, level, sourceFile }) =>
          canonicalizeRecords(record, level, sourceFile)
        )
        .filter(hasUsableData),
    };
  }
  if (
    !hasDataIntent &&
    !capabilityQuestion &&
    findPlaceTargets(query, csvRowCache.rows, false).length === 0
  ) {
    return null;
  }
  return answerCsvQuestionFromRows(query, csvRowCache.rows, options);
}

export function answerCsvQuestionFromRecords(
  query: string,
  records: CsvRecord[],
  options: CsvQuestionOptions = {}
): string | null {
  const currentQuery = options.currentQuery ?? query;
  const hasDataIntent = isCsvDataQuestion(currentQuery) || isCsvDataQuestion(query);
  const capabilityQuestion = isCsvCapabilityQuestion(currentQuery);
  const potentialPlaceQuestion = isPotentialPlaceQuestion(currentQuery);
  if (!hasDataIntent && !capabilityQuestion && !potentialPlaceQuestion) return null;

  const rows = records
    .flatMap((record) => canonicalizeRecords(record))
    .filter(hasUsableData);
  if (
    !hasDataIntent &&
    !capabilityQuestion &&
    findPlaceTargets(query, rows, false).length === 0
  ) {
    return null;
  }
  return answerCsvQuestionFromRows(query, rows, options);
}

function answerCsvQuestionFromRows(
  query: string,
  allRows: DataRow[],
  options: CsvQuestionOptions
): string {
  if (allRows.length === 0) {
    return withReference(CSV_NO_DATA_REPLY, undefined, undefined, options);
  }

  const currentQuery = options.currentQuery ?? query;
  if (isCsvCapabilityQuestion(currentQuery)) {
    return answerCsvCapabilityQuestion(currentQuery, allRows);
  }
  if (isTotalLifeYearsDefinition(currentQuery)) {
    return "Understood. Total life-years lost means life loss per person multiplied by the location’s population. I’ll use that calculation for total-life-loss questions.\n\nReference: User-provided calculation definition.";
  }
  const benchmark = parseBenchmark(
    hasBenchmarkSelection(currentQuery) ? currentQuery : query
  );
  const allTargets = findPlaceTargets(query, allRows, false);
  const intent = resolveDataIntent(currentQuery, query, allTargets);
  let geography = inferQuestionLevel(currentQuery) ?? inferLevel(query);
  if (!geography) {
    geography = mostSpecificTarget(allTargets)?.level;
  }
  if ((intent === "ranking" || intent === "threshold_filter") && !geography) {
    return withReference(
      "Do you want this at country or state/province level?",
      undefined,
      benchmark,
      options
    );
  }
  if (geography === "region") geography = "country";
  const csvLevel = geography ? csvLevelForGeography(geography) : undefined;
  const rows = csvLevel
    ? allRows.filter((row) => row.csvLevel === csvLevel)
    : allRows;
  if (csvLevel && rows.length === 0) {
    if (geography === "district") {
      return withReference(
        "District-level data is not currently available. I can answer this at country or state/province level. Would you like the state/province-level result instead?",
        "gadm2",
        benchmark,
        options,
        query
      );
    }
    return withReference(CSV_NO_DATA_REPLY, csvLevel, benchmark, options, query);
  }
  let answer: string;
  if (intent === "threshold_filter") {
    answer = answerThresholdFilter(query, rows, currentQuery, geography!);
  } else if (intent === "ranking") {
    answer = answerRanking(query, rows, benchmark, currentQuery, geography!);
  } else if (intent === "peak_change") {
    answer = answerPeakChange(query, rows, benchmark);
  } else if (intent === "peak_value") {
    answer = answerPeakValue(query, rows, benchmark);
  } else if (intent === "comparison") {
    answer = answerComparison(query, allRows, benchmark, currentQuery);
  } else if (intent === "trend") {
    answer = answerTrend(query, rows, benchmark, currentQuery);
  } else {
    answer = answerDirectValue(query, rows, benchmark, currentQuery);
  }

  const comparisonSource = intent === "comparison"
    ? comparisonSourceLabel(allTargets)
    : undefined;
  return withReference(
    answer,
    csvLevel,
    benchmark,
    options,
    query,
    comparisonSource
  );
}

function isCsvDataQuestion(query: string): boolean {
  if (
    /\b(methodology|definition|define|what is aqli|how does aqli|why|explain how|policy|limitation)\b/i.test(
      query
    ) || /^\s*what (?:is|are) pm\s*2\.?5\s*\??\s*$/i.test(query)
  ) {
    return false;
  }

  return (
    /\b(pm\s*2\.?5|pollution|polluted|cleanest|dirtiest|life (?:loss|gain|expectancy)|llpp|population|highest|lowest|top|bottom|most|least|rank|ranking|trend|change|changed|compare|comparison|difference|versus|best|worst|improved|improvement|worsened|country|countries|region|state|province|district|year|benchmark|standard|std|national standard)\b/i.test(
      query
    ) || hasWhoBenchmark(query)
  );
}

function isCsvCapabilityQuestion(query: string): boolean {
  return /\b(?:do you|can you|you)\s+(?:have\s+)?access\b[\s\S]*\b(?:gadm\s*[012]|csv)\b/i.test(
    query
  );
}

function isPotentialPlaceQuestion(query: string): boolean {
  const trimmed = query.trim();
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  if (wordCount === 0 || wordCount > 6) return false;
  return !/\b(?:hi|hello|hey|thanks?|thank you|annual report|methodology|wildfires?|story|policy|why|explain|define|what is aqli|what is pm\s*2\.?5|since\s+(?:19|20)\d{2})\b/i.test(
    trimmed
  );
}

function answerCsvCapabilityQuestion(query: string, rows: DataRow[]): string {
  const available = new Set(
    rows.map((row) => row.csvLevel).filter((level): level is CsvDatasetLevel => Boolean(level))
  );
  const requested = Array.from(
    query.matchAll(/\bgadm\s*([012])\b/gi),
    (match) => `gadm${match[1]}` as CsvDatasetLevel
  );
  const activeLabels = (["gadm0", "gadm1", "gadm2"] as CsvDatasetLevel[])
    .filter((level) => available.has(level))
    .map(csvLevelLabel);
  const missingLabels = requested
    .filter((level) => !available.has(level))
    .map(csvLevelLabel);

  const answer = missingLabels.length
    ? `${missingLabels.join(" and ")} ${missingLabels.length === 1 ? "is" : "are"} not currently uploaded and active. Available now: ${activeLabels.join(", ") || "none"}.`
    : `Yes. I currently have access to ${activeLabels.join(", ") || "no active GADM CSV files"}.`;
  return `${answer}\n\nReference checked: active GADM CSV sources.`;
}

async function loadActiveCsvRecords(): Promise<LoadedCsvRecord[]> {
  const supabase = createServiceClient();
  const { data: sources, error: sourceError } = await supabase
    .from("knowledge_sources")
    .select("id, title, file_path, created_at, updated_at, chunk_count")
    .eq("status", "active");

  if (sourceError) {
    console.error("[csv-query] failed to load sources", {
      code: sourceError.code,
    });
    return [];
  }

  const csvSources = (sources ?? []).filter((source) =>
    source.file_path?.toLowerCase().endsWith(".csv")
  );
  const classifiedSources = await Promise.all(
    csvSources.map(async (source) => {
      const namedLevel = inferCsvDatasetLevel({
        title: source.title,
        filePath: source.file_path,
      });
      if (namedLevel) return { ...source, dataset_level: namedLevel };

      const { data: firstChunk } = await supabase
        .from("knowledge_chunks")
        .select("metadata")
        .eq("source_id", source.id)
        .order("chunk_index")
        .limit(1)
        .maybeSingle();
      const columns = Array.isArray(firstChunk?.metadata?.csv_columns)
        ? (firstChunk.metadata.csv_columns as unknown[]).filter(
            (column: unknown): column is string => typeof column === "string"
          )
        : undefined;
      return {
        ...source,
        dataset_level: inferCsvDatasetLevel({ columns }),
      };
    })
  );
  const selectedSources = selectLatestCsvSources(classifiedSources);
  const sourceIds = selectedSources.map((source) => source.id);
  if (sourceIds.length === 0) return [];

  const sourceInfo = new Map(
    selectedSources.map((source) => [
      source.id,
      {
        level: source.dataset_level,
        sourceFile: source.file_path ?? "CSV",
      },
    ])
  );

  const signature = selectedSources
    .map(
      (source) =>
        `${source.id}:${source.updated_at ?? ""}:${source.chunk_count ?? 0}`
    )
    .sort()
    .join("|");
  if (
    csvRecordCache?.signature === signature &&
    csvRecordCache.expiresAt > Date.now()
  ) {
    return csvRecordCache.records;
  }

  const records: LoadedCsvRecord[] = [];
  const seenRecords = new Set<string>();
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("knowledge_chunks")
      .select("source_id, metadata, content")
      .in("source_id", sourceIds)
      .order("chunk_index")
      .range(from, from + pageSize - 1);
    if (error) {
      console.error("[csv-query] failed to load records", { code: error.code });
      return [];
    }

    for (const chunk of data ?? []) {
      const info = sourceInfo.get(chunk.source_id);
      if (!info) continue;
      const chunkRecords = chunk.metadata?.csv_records;
      const candidates = Array.isArray(chunkRecords)
        ? chunkRecords
        : parseLegacyCsvRecords(chunk.content ?? "");
      for (const record of candidates) {
        if (!isStringRecord(record)) continue;
        const key = `${chunk.source_id}:${JSON.stringify(record)}`;
        if (seenRecords.has(key)) continue;
        seenRecords.add(key);
        const metadataColumns = Array.isArray(chunk.metadata?.csv_columns)
          ? (chunk.metadata.csv_columns as unknown[]).filter(
              (column: unknown): column is string => typeof column === "string"
            )
          : undefined;
        records.push({
          record,
          level:
            info.level ??
            inferCsvDatasetLevel({ columns: metadataColumns ?? Object.keys(record) }),
          sourceFile: info.sourceFile,
        });
      }
    }
    if ((data ?? []).length < pageSize) break;
  }
  csvRecordCache = {
    signature,
    records,
    expiresAt: Date.now() + CSV_CACHE_TTL_MS,
  };
  return records;
}

function canonicalizeRecords(
  record: CsvRecord,
  sourceLevel?: CsvDatasetLevel,
  sourceFile = "CSV"
): DataRow[] {
  const normalized = new Map(
    Object.entries(record).map(([key, value]) => [normalizeColumn(key), value])
  );
  const get = (field: CsvDataField) => {
    for (const alias of FIELD_ALIASES[field]) {
      const value = normalized.get(normalizeColumn(alias));
      if (value !== undefined && value !== "") return value;
    }
    return undefined;
  };

  const base: DataRow = {
    region: cleanPlace(get("region")),
    country: cleanPlace(get("country")),
    state: cleanPlace(get("state")),
    district: cleanPlace(get("district")),
    year: parseYear(get("year")),
    pm25: parseNumeric(get("pm25")),
    llpp: parseNumeric(get("llpp")),
    llppWho: parseNumeric(get("llppWho")),
    llppNational: parseNumeric(get("llppNational")),
    population: parseNumeric(get("population")),
    whoStandard: parseNumeric(get("whoStandard")),
    nationalStandard: parseNumeric(get("nationalStandard")),
    csvLevel:
      sourceLevel ??
      inferCsvDatasetLevel({ columns: Object.keys(record) }),
    sourceFile,
  };

  if (base.year !== undefined) return [base];

  const years = new Set<number>();
  for (const key of normalized.keys()) {
    const match = key.match(/^(?:pm|llppwho|llppnat)((?:19|20)\d{2})$/);
    if (match) years.add(Number(match[1]));
  }
  if (years.size === 0) return [base];

  return Array.from(years)
    .sort((left, right) => left - right)
    .map((year) => ({
      ...base,
      year,
      pm25: parseNumeric(normalized.get(`pm${year}`)),
      llppWho: parseNumeric(normalized.get(`llppwho${year}`)),
      llppNational: parseNumeric(normalized.get(`llppnat${year}`)),
    }));
}

function parseLegacyCsvRecords(content: string): CsvRecord[] {
  const headers = Array.from(
    content.matchAll(/CSV record \d+ from [^\n]*\n/gi)
  );
  const records: CsvRecord[] = [];

  headers.forEach((header, index) => {
    const start = header.index! + header[0].length;
    const end = headers[index + 1]?.index ?? content.length;
    const record: CsvRecord = {};
    for (const line of content.slice(start, end).split("\n")) {
      const separator = line.indexOf(":");
      if (separator <= 0) continue;
      const key = line.slice(0, separator).trim();
      const value = line.slice(separator + 1).trim();
      if (key && value) record[key] = value;
    }
    if (Object.keys(record).length) records.push(record);
  });
  return records;
}

function answerThresholdFilter(
  query: string,
  rows: DataRow[],
  currentQuery: string,
  level: GeographyLevel
): string {
  const currentCondition = parseNumericCondition(currentQuery);
  const condition = currentCondition ?? parseNumericCondition(query);
  if (!condition) return "Which value and condition should I use?";

  const currentTargets = findPlaceTargets(currentQuery, rows, false);
  const scopeTarget = (currentTargets.length
    ? currentTargets
    : findPlaceTargets(query, rows, false)
  ).find((target) => levelPriority(target.level) < levelPriority(level));
  const scopedRows = scopeTarget
    ? rows.filter(
        (row) =>
          normalizePlace(row[scopeTarget.level] ?? "") ===
          normalizePlace(scopeTarget.value)
      )
    : rows;
  const requestedYear = requestedYears(currentQuery).at(-1);
  const year =
    requestedYear ?? latestYear(scopedRows.filter((row) => row[level]));
  if (year === undefined) return CSV_NO_DATA_REPLY;

  const summaries = summarizeByLevel(
    scopedRows.filter((row) => row.year === year && row[level]),
    level
  ).filter(
    (row) =>
      level !== "country" ||
      !NON_SOVEREIGN_GADM0_LABELS.has(normalizePlace(row.country ?? ""))
  );
  const matches = summaries
    .map((row) => ({ row, value: numericMetricValue(row, condition.metric) }))
    .filter(
      (item): item is { row: DataRow; value: number } =>
        item.value !== undefined &&
        numericConditionMatches(item.value, condition)
    )
    .sort((left, right) => {
      if (condition.operator === "eq") {
        return rankingPlaceLabel(left.row, level).localeCompare(
          rankingPlaceLabel(right.row, level)
        );
      }
      return condition.operator === "lt" || condition.operator === "lte"
        ? left.value - right.value
        : right.value - left.value;
    });
  const metricLabel = numericMetricLabel(condition.metric);
  const comparisonLabel = numericOperatorLabel(condition.operator);
  const thresholdText = formatNumericMetric(condition.threshold, condition.metric);
  const scopeLabel = scopeTarget ? ` in ${scopeTarget.value}` : "";
  if (matches.length === 0) {
    return `No ${pluralLevel(level)}${scopeLabel} in the current dataset have ${metricLabel} ${comparisonLabel} ${thresholdText}.`;
  }

  if (/\b(?:how many|number of|count)\b/i.test(currentQuery)) {
    return `${matches.length} ${pluralLevel(level)}${scopeLabel} have ${metricLabel} ${comparisonLabel} ${thresholdText}, ${year}.`;
  }

  const count = Math.min(matches.length, 25);
  const list = matches
    .slice(0, count)
    .map(
      ({ row, value }, index) =>
        `${index + 1}. ${rankingPlaceLabel(row, level, !scopeTarget && level !== "country")} — ${formatNumericMetric(value, condition.metric)}`
    );
  const limitNote =
    matches.length > count
      ? `\n\nShowing the first ${count} of ${matches.length} matches.`
      : "";
  const countryNote =
    level === "country"
      ? "\n\nKnown non-country territory entries are excluded."
      : "";
  return `${capitalize(pluralLevel(level))}${scopeLabel} with ${metricLabel} ${comparisonLabel} ${thresholdText}, ${year}:\n${list.join("\n")}${limitNote}${countryNote}`;
}

function parseNumericCondition(query: string): NumericCondition | undefined {
  const normalizedQuery = query.replace(
    /\b(less|more|greater|higher|lower|fewer|smaller|larger)\s+then\b/gi,
    "$1 than"
  );
  const candidates: Array<{
    index: number;
    operator: NumericOperator;
    threshold: number;
  }> = [];
  const operatorPattern =
    /(less than or equal to|lower than or equal to|equal to or less than|equal to or below|more than or equal to|greater than or equal to|higher than or equal to|equal to or greater than|equal to or more than|equal to or higher than|equal to or above|at most|no more than|not more than|no greater than|not greater than|no higher than|maximum of|max of|at least|no less than|not less than|minimum of|min of|less than|lower than|fewer than|smaller than|below|under|short of|more than|greater than|higher than|larger than|above|over|exceeds|exceeded|exceeding|in excess of|is equal to|is exactly|exactly equal to|equal to|equals to|equals|same as|equivalent to|exactly|is)\s*(\d[\d,]*(?:\.\d+)?)\s*(thousand|million|billion)?/gi;
  for (const match of normalizedQuery.matchAll(operatorPattern)) {
    candidates.push({
      index: match.index!,
      operator: numericOperatorFromText(match[1]),
      threshold: scaledNumber(match[2], match[3]),
    });
  }
  for (const match of normalizedQuery.matchAll(
    /(<=|=<|>=|=>|==|=|<|>|≤|≥)\s*(\d[\d,]*(?:\.\d+)?)\s*(thousand|million|billion)?/g
  )) {
    candidates.push({
      index: match.index!,
      operator: numericOperatorFromText(match[1]),
      threshold: scaledNumber(match[2], match[3]),
    });
  }
  for (const match of normalizedQuery.matchAll(
    /(\d[\d,]*(?:\.\d+)?)\s*(thousand|million|billion)?\s*(or less|or fewer|or lower|or below|or under|and below|or more|or higher|or above|and above)/gi
  )) {
    candidates.push({
      index: match.index!,
      operator: /less|fewer|lower|below|under/i.test(match[3]) ? "lte" : "gte",
      threshold: scaledNumber(match[1], match[2]),
    });
  }
  const selected = candidates.sort((left, right) => right.index - left.index)[0];
  if (!selected || !Number.isFinite(selected.threshold)) return undefined;

  const metric = /\bpopulation\b/i.test(normalizedQuery)
    ? "population"
    : /\b(?:life\s+(?:year\s+)?loss|life expectancy loss|llpp|years? lost)\b/i.test(normalizedQuery)
      ? hasNationalBenchmark(normalizedQuery)
        ? "llppNational"
        : "llppWho"
      : hasNationalBenchmark(normalizedQuery)
        ? "nationalStandard"
        : hasWhoBenchmark(normalizedQuery)
          ? "whoStandard"
          : /\bpm\s*2\.?5|pollution(?: level| value)?\b/i.test(normalizedQuery)
            ? "pm25"
            : undefined;
  return metric ? { ...selected, metric } : undefined;
}

function numericOperatorFromText(value: string): NumericOperator {
  if (/^(?:<=|=<|≤|less than or equal to|lower than or equal to|equal to or less than|equal to or below|at most|no more than|not more than|no greater than|not greater than|no higher than|maximum of|max of)$/i.test(value)) return "lte";
  if (/^(?:>=|=>|≥|more than or equal to|greater than or equal to|higher than or equal to|equal to or greater than|equal to or more than|equal to or higher than|equal to or above|at least|no less than|not less than|minimum of|min of)$/i.test(value)) return "gte";
  if (/^(?:=|==|is|is equal to|is exactly|exactly equal to|equal to|equals to|equals|same as|equivalent to|exactly)$/i.test(value)) return "eq";
  if (/^(?:<|less than|lower than|fewer than|smaller than|below|under|short of)$/i.test(value)) return "lt";
  return "gt";
}

function scaledNumber(value: string, scale?: string): number {
  const base = Number(value.replace(/,/g, ""));
  const multiplier = /^billion$/i.test(scale ?? "")
    ? 1_000_000_000
    : /^million$/i.test(scale ?? "")
      ? 1_000_000
      : /^thousand$/i.test(scale ?? "")
        ? 1_000
        : 1;
  return base * multiplier;
}

function numericMetricValue(row: DataRow, metric: NumericMetric): number | undefined {
  if (metric === "llppWho") return lifeLoss(row, { type: "who", target: 5 });
  if (metric === "llppNational") return lifeLoss(row, { type: "national" });
  return row[metric];
}

function numericConditionMatches(value: number, condition: NumericCondition): boolean {
  if (condition.operator === "lt") return value < condition.threshold;
  if (condition.operator === "lte") return value <= condition.threshold;
  if (condition.operator === "gt") return value > condition.threshold;
  if (condition.operator === "gte") return value >= condition.threshold;
  return Math.abs(value - condition.threshold) < 1e-9;
}

function numericMetricLabel(metric: NumericMetric): string {
  if (metric === "nationalStandard") return "national PM2.5 standard";
  if (metric === "whoStandard") return "WHO PM2.5 guideline";
  if (metric === "llppWho") return "WHO-based life loss";
  if (metric === "llppNational") return "national-standard life loss";
  return metric === "population" ? "population" : "PM2.5";
}

function numericOperatorLabel(operator: NumericOperator): string {
  if (operator === "lt") return "below";
  if (operator === "lte") return "at or below";
  if (operator === "eq") return "equal to";
  if (operator === "gte") return "at or above";
  return "above";
}

function formatNumericMetric(value: number, metric: NumericMetric): string {
  if (metric === "population") return `${formatInteger(value)} people`;
  if (metric === "llppWho" || metric === "llppNational") {
    return `${formatNumber(value)} years`;
  }
  return `${formatNumber(value)} µg/m³`;
}

function answerRanking(
  query: string,
  rows: DataRow[],
  benchmark: Benchmark,
  currentQuery: string,
  level: GeographyLevel
): string {
  const scopeTarget = findPlaceTargets(query, rows, false).find(
    (target) => levelPriority(target.level) < levelPriority(level)
  );
  const requestsAll = /\b(?:each|all)\s+(?:of\s+the\s+)?(?:countries|states?|provinces?|districts?)\b/i.test(
    query
  ) || /\blist\s+(?:of\s+)?(?:countries|states?|provinces?|districts?)\b/i.test(query);
  const explicitGlobalScope = isGlobalScope(query);
  if (!scopeTarget && !explicitGlobalScope) {
    const requestedCount = parseRequestedCount(query);
    if (level === "state") {
      return requestedCount
        ? `Sure. Which country should I use for the top ${requestedCount} states?`
        : "Sure. Which country should I use for the state ranking?";
    }
  }
  const scopedRows = scopeTarget
    ? rows.filter(
        (row) =>
          normalizePlace(row[scopeTarget.level] ?? "") ===
          normalizePlace(scopeTarget.value)
      )
    : rows;

  const requested = questionYears(query, currentQuery);
  const changeRanking = /\b(improved|improvement|worsened|worsening|change|changed|increase|increased|rise|decrease|decreased)\b/i.test(query);
  if (changeRanking) {
    return answerChangeRanking(
      currentQuery,
      scopedRows,
      level,
      benchmark,
      requested
    );
  }

  const availableYears = Array.from(
    new Set(scopedRows.filter((row) => row[level]).map((row) => row.year).filter(isNumber))
  ).sort((left, right) => left - right);
  const annualChoice = annualRankingChoice(currentQuery);
  const requestedCount = parseRequestedCount(query);
  if (
    asksForAnnualLeader(query) &&
    requestedCount > 1 &&
    annualChoice === undefined &&
    !/\bthen\s+(?:please\s+)?give(?:\s+me)?[\s\S]*\b(?:most polluted|highest|worst|least polluted|lowest)\b[\s\S]*\b(?:each|every)\s+year\b/i.test(query)
  ) {
    return `Do you want (1) the top ${requestedCount} ${pluralLevel(level)} averaged across the period, or (2) the single most polluted ${level} for each year?`;
  }
  const relativeRange = relativeYearRange(query, availableYears);
  const period = requested.length >= 2
    ? ([requested[0], requested[requested.length - 1]] as [number, number])
    : relativeRange ?? ((asksForAnnualLeader(query) || annualChoice !== undefined) && availableYears.length
      ? ([availableYears[0], availableYears.at(-1)!] as [number, number])
      : undefined);
  if (period && (!availableYears.includes(period[0]) || !availableYears.includes(period[1]))) {
    return missingYearReply();
  }
  if (period && (annualChoice === "leader" || (asksForAnnualLeader(query) && annualChoice !== "average"))) {
    return answerAnnualLeaders(
      query,
      scopedRows,
      level,
      benchmark,
      period[0],
      period[1],
      Boolean(scopeTarget)
    );
  }

  if (period) {
    const periodRows = summarizePeriodByLevel(
      scopedRows.filter(
        (row) => row.year !== undefined && row.year >= period[0] && row.year <= period[1]
      ),
      level
    );
    return formatRanking(
      query,
      periodRows,
      level,
      benchmark,
      scopeTarget,
      explicitGlobalScope,
      requestsAll,
      `${period[0]}–${period[1]} average`
    );
  }

  const requestedYear = requested.at(-1);
  const year = requestedYear ?? latestYear(scopedRows.filter((row) => row[level]));
  if (year === undefined) return CSV_NO_DATA_REPLY;
  if (
    requestedYear !== undefined &&
    !scopedRows.some((row) => row[level] && row.year === requestedYear)
  ) {
    return missingYearReply();
  }

  const summaries = summarizeByLevel(
    scopedRows.filter((row) => row.year === year && row[level]),
    level
  );
  return formatRanking(
    query,
    summaries,
    level,
    benchmark,
    scopeTarget,
    explicitGlobalScope,
    requestsAll,
    String(year)
  );
}

function formatRanking(
  query: string,
  summaries: DataRow[],
  level: GeographyLevel,
  benchmark: Benchmark,
  scopeTarget: PlaceTarget | undefined,
  explicitGlobalScope: boolean,
  requestsAll: boolean,
  periodLabel: string
): string {
  const ranksPopulation = /\b(population|populated)\b/i.test(query);
  const ranksLiveability =
    level === "country" && /\b(?:best[\s\S]*live|least polluted|cleanest)\b/i.test(query);
  const ranksLifeLoss =
    !ranksPopulation && /\b(life|llpp|years? lost|years? gained)\b/i.test(query);
  const ranked = summaries
    .map((row) => ({
      row,
      value: ranksPopulation
        ? row.population
        : ranksLifeLoss
          ? lifeLoss(row, benchmark)
          : row.pm25,
    }))
    .filter(
      (item): item is { row: DataRow; value: number } =>
        item.value !== undefined &&
        (!ranksLiveability ||
          (item.row.pm25 !== undefined &&
            item.row.pm25 > 0 &&
            item.row.population !== undefined &&
            item.row.population > 0 &&
            !NON_SOVEREIGN_GADM0_LABELS.has(
              normalizePlace(item.row.country ?? "")
            )))
    );
  if (ranked.length === 0) return CSV_NO_DATA_REPLY;

  const ascending = /\b(lowest|bottom|least)\b/i.test(query);
  ranked.sort((left, right) =>
    ascending ? left.value - right.value : right.value - left.value
  );
  const requestedCount = parseRequestedCount(query);
  const requestsSingle = /\b(?:top|highest|lowest|best|worst|most polluted|least polluted)\s+(?:country|state|province|district)\b/i.test(
    query
  );
  const count = Math.min(
    requestedCount || (requestsAll ? ranked.length : requestsSingle ? 1 : 3),
    requestsAll ? 25 : 10,
    ranked.length
  );
  const unit = ranksPopulation ? "people" : ranksLifeLoss ? "years" : "µg/m³";
  const levelLabel = pluralLevel(level);
  const list = ranked
    .slice(0, count)
    .map(
      ({ row, value }, index) => {
        const loss = lifeLoss(row, benchmark);
        const pm25Text = row.pm25 !== undefined
          ? `${formatNumber(row.pm25)} µg/m³ PM2.5`
          : undefined;
        const lossText = loss !== undefined
          ? `${formatNumber(loss)} years life loss`
          : undefined;
        const populationText = row.population !== undefined
          ? `${formatInteger(row.population)} people`
          : undefined;
        const values = ranksPopulation
          ? [populationText, pm25Text, lossText]
          : ranksLifeLoss
            ? [lossText, pm25Text]
            : [pm25Text, lossText];
        return `${index + 1}. ${rankingPlaceLabel(row, level, explicitGlobalScope && !scopeTarget)} — ${values.filter(Boolean).join("; ") || `${formatNumber(value)} ${unit}`}`;
      }
    );
  const interpretation = ranksLifeLoss
    ? requestsAll
      ? `\n\nThese are the estimated life expectancy losses for the available ${levelLabel} in the current dataset.`
      : `\n\nThese ${levelLabel} show the ${ascending ? "lowest" : "highest"} estimated life expectancy loss from PM2.5 exposure in the current dataset.`
    : "";
  const limitNote = requestsAll && ranked.length > count
    ? `\n\nShowing the first ${count} of ${ranked.length} ${levelLabel}.`
    : "";
  const liveabilityNote = ranksLiveability
    ? "\n\nThis ranks sovereign-country entries by PM2.5 only, not overall quality of life."
    : "";
  const scopeLabel = scopeTarget ? ` in ${scopeTarget.value}` : "";
  const displayedLevel = count === 1 ? level : levelLabel;
  const heading = requestsAll
    ? `Here are all available ${levelLabel}${scopeLabel}, ${periodLabel} (${benchmarkLabel(benchmark)}):`
    : ranksPopulation
      ? count === 1
        ? `Here is the ${ascending ? "least" : "most"} populated ${displayedLevel}${scopeLabel}, ${periodLabel} (${benchmarkLabel(benchmark)}):`
        : `Here are the ${count} ${ascending ? "least" : "most"} populated ${displayedLevel}${scopeLabel}, ${periodLabel} (${benchmarkLabel(benchmark)}):`
      : count === 1
        ? `Here is the ${ascending ? "lowest" : "top"} ${displayedLevel}${scopeLabel}, ${periodLabel} (${benchmarkLabel(benchmark)}):`
        : `Here are the ${ascending ? "lowest" : "top"} ${count} ${displayedLevel}${scopeLabel}, ${periodLabel} (${benchmarkLabel(benchmark)}):`;
  return `${heading}\n${list.join("\n")}${limitNote}${interpretation}${liveabilityNote}`;
}

function asksForAnnualLeader(query: string): boolean {
  return (
    /\b(?:each|every)\s+year\b/i.test(query) ||
    /\bfor\s+(?:each|every)\s+year\b/i.test(query) ||
    /\bper\s+year\b/i.test(query)
  );
}

function annualRankingChoice(query: string): "average" | "leader" | undefined {
  const trimmed = query.trim().toLowerCase();
  if (/^(?:1|option\s*1|first|average|period average)[.!\s]*$/.test(trimmed)) {
    return "average";
  }
  if (/^(?:2|option\s*2|second|annual|each year|every year)[.!\s]*$/.test(trimmed)) {
    return "leader";
  }
  return undefined;
}

function answerAnnualLeaders(
  query: string,
  rows: DataRow[],
  level: GeographyLevel,
  benchmark: Benchmark,
  startYear: number,
  endYear: number,
  hasScope: boolean
): string {
  const ranksLifeLoss = /\b(life|llpp|years? lost|years? gained)\b/i.test(query);
  const ascending = /\b(lowest|least|cleanest|bottom)\b/i.test(query);
  const lines: string[] = [];

  for (let year = startYear; year <= endYear; year += 1) {
    const candidates = summarizeByLevel(
      rows.filter((row) => row.year === year && row[level]),
      level
    )
      .map((row) => ({
        row,
        value: ranksLifeLoss ? lifeLoss(row, benchmark) : row.pm25,
      }))
      .filter(
        (item): item is { row: DataRow; value: number } => item.value !== undefined
      )
      .sort((left, right) =>
        ascending ? left.value - right.value : right.value - left.value
      );
    const winner = candidates[0];
    if (!winner) continue;
    const loss = lifeLoss(winner.row, benchmark);
    lines.push(
      `${year}: ${rankingPlaceLabel(winner.row, level, !hasScope)} — ${formatNumber(winner.row.pm25!)} µg/m³ PM2.5${loss !== undefined ? `; ${formatNumber(loss)} years life loss` : ""}`
    );
  }

  if (lines.length === 0) return CSV_NO_DATA_REPLY;
  return `${ascending ? "Least" : "Most"} polluted ${level} for each year, ${startYear}–${endYear}:\n${lines.join("\n")}`;
}

function answerChangeRanking(
  query: string,
  rows: DataRow[],
  level: GeographyLevel,
  benchmark: Benchmark,
  requested: number[]
): string {
  const availableYears = Array.from(
    new Set(rows.filter((row) => row[level]).map((row) => row.year).filter(isNumber))
  ).sort((left, right) => left - right);
  if (availableYears.length < 2) return CSV_NO_DATA_REPLY;

  const relativeRange = relativeYearRange(query, availableYears);
  const startYear = requested[0] ?? relativeRange?.[0] ?? availableYears[0];
  const endYear = requested[1] ?? relativeRange?.[1] ?? availableYears[availableYears.length - 1];
  if (!availableYears.includes(startYear) || !availableYears.includes(endYear)) {
    return missingYearReply();
  }

  const startRows = summarizeByLevel(
    rows.filter((row) => row.year === startYear && row[level]),
    level
  );
  const endRows = summarizeByLevel(
    rows.filter((row) => row.year === endYear && row[level]),
    level
  );
  const startByPlace = new Map(
    startRows.map((row) => [rankingPlaceKey(row, level), row])
  );
  const ranksLifeLoss = /\b(life|llpp|years? lost|years? gained)\b/i.test(query);
  const bothBenchmarks = ranksLifeLoss && wantsBothBenchmarks(query);
  const changes = endRows
    .map((end) => {
      const start = startByPlace.get(rankingPlaceKey(end, level));
      const selectedBenchmark = bothBenchmarks
        ? ({ type: "who", target: 5 } as const)
        : benchmark;
      const startValue = start
        ? ranksLifeLoss
          ? lifeLoss(start, selectedBenchmark)
          : start.pm25
        : undefined;
      const endValue = ranksLifeLoss ? lifeLoss(end, selectedBenchmark) : end.pm25;
      const startLoss = start ? lifeLoss(start, selectedBenchmark) : undefined;
      const endLoss = lifeLoss(end, selectedBenchmark);
      const whoStart = start ? lifeLoss(start, { type: "who", target: 5 }) : undefined;
      const whoEnd = lifeLoss(end, { type: "who", target: 5 });
      const nationalStart = start ? lifeLoss(start, { type: "national" }) : undefined;
      const nationalEnd = lifeLoss(end, { type: "national" });
      return start && startValue !== undefined && endValue !== undefined
        ? {
            row: end,
            startValue,
            endValue,
            change: endValue - startValue,
            lossChange:
              startLoss !== undefined && endLoss !== undefined
                ? endLoss - startLoss
                : undefined,
            whoChange:
              whoStart !== undefined && whoEnd !== undefined
                ? whoEnd - whoStart
                : undefined,
            nationalChange:
              nationalStart !== undefined && nationalEnd !== undefined
                ? nationalEnd - nationalStart
                : undefined,
          }
        : undefined;
    })
    .filter(
      (item): item is {
        row: DataRow;
        startValue: number;
        endValue: number;
        change: number;
        lossChange: number | undefined;
        whoChange: number | undefined;
        nationalChange: number | undefined;
      } => item !== undefined
    );
  if (changes.length === 0) return CSV_NO_DATA_REPLY;

  const seeksDecrease = /\b(decrease|decreased|improved|improvement|lowest|least)\b/i.test(query);
  const seeksImprovement = /\b(?:improved|improvement)\b/i.test(query);
  const benchmarkCompleteChanges = bothBenchmarks
    ? changes.filter((item) => item.nationalChange !== undefined)
    : changes;
  const directionalChanges = seeksImprovement
    ? benchmarkCompleteChanges.filter((item) => item.change < 0)
    : /\b(?:worsened|worsening|increased|increase|rise)\b/i.test(query)
      ? benchmarkCompleteChanges.filter((item) => item.change > 0)
      : benchmarkCompleteChanges;
  if (directionalChanges.length === 0) return CSV_NO_DATA_REPLY;
  directionalChanges.sort((left, right) =>
    seeksDecrease ? left.change - right.change : right.change - left.change
  );
  const requestedCount = parseRequestedCount(query);
  const requestsSingle = /\bwhich\s+(?:country|state|province|district)\b/i.test(query);
  const requestsList = /\blist\s+(?:of\s+)?(?:countries|states?|provinces?|districts?)\b/i.test(query);
  const count = Math.min(
    requestedCount || (requestsSingle ? 1 : requestsList ? 10 : 3),
    10,
    directionalChanges.length
  );
  const unit = ranksLifeLoss ? "years" : "µg/m³";
  const label = seeksImprovement
    ? "Largest improvements"
    : seeksDecrease
      ? "Largest decreases"
      : "Largest increases";
  const globalScope = isGlobalScope(query);
  const list = directionalChanges
    .slice(0, count)
    .map(
      ({ row, startValue, endValue, change, lossChange, nationalChange }, index) =>
        bothBenchmarks
          ? `${index + 1}. ${rankingPlaceLabel(row, level, globalScope)} — WHO ${formatNumber(Math.abs(change))} years improvement (${formatNumber(startValue)} → ${formatNumber(endValue)}); national ${formatNumber(Math.abs(nationalChange!))} years improvement`
          : `${index + 1}. ${rankingPlaceLabel(row, level, globalScope)} — ${seeksImprovement ? `${formatNumber(Math.abs(change))} ${unit} improvement` : `${formatSigned(change)} ${unit}`} (${formatNumber(startValue)} → ${formatNumber(endValue)})${lossChange !== undefined ? `; life loss ${seeksImprovement ? formatNumber(Math.abs(lossChange)) : formatSigned(lossChange)} years${seeksImprovement ? " improvement" : ""}` : ""}`
    );
  return `${label} among ${pluralLevel(level)}, ${startYear}–${endYear}:\n${list.join("\n")}`;
}

function answerComparison(
  query: string,
  rows: DataRow[],
  benchmark: Benchmark,
  currentQuery: string
): string {
  const targets = findPlaceTargets(query, rows)
    .slice(0, 2)
    .sort((left, right) => left.position - right.position);
  if (targets.length < 2) {
    return targets.length === 1
      ? `Which ${targets[0].level} would you like to compare with ${targets[0].value}?`
      : "Which two places would you like me to compare?";
  }
  const levelNote = comparisonLevelNote(targets);

  const firstRows = rowsForTarget(rows, targets[0]);
  const secondRows = rowsForTarget(rows, targets[1]);
  const firstYears = new Set(firstRows.map((row) => row.year).filter(isNumber));
  const commonYearList = Array.from(
    new Set(
      secondRows
        .map((row) => row.year)
        .filter((value): value is number => isNumber(value) && firstYears.has(value))
    )
  ).sort((left, right) => left - right);
  if (commonYearList.length === 0) return CSV_NO_DATA_REPLY;

  const years = questionYears(query, currentQuery);
  const relativeRange =
    relativeYearRange(currentQuery, commonYearList) ??
    relativeYearRange(query, commonYearList);
  const period = years.length >= 2
    ? ([years[0], years.at(-1)!] as [number, number])
    : relativeRange;
  if (period) {
    const [startYear, endYear] = period;
    if (!commonYearList.includes(startYear) || !commonYearList.includes(endYear)) {
      return missingYearReply();
    }
    const firstStart = summarizeTarget(firstRows, targets[0], startYear);
    const firstEnd = summarizeTarget(firstRows, targets[0], endYear);
    const secondStart = summarizeTarget(secondRows, targets[1], startYear);
    const secondEnd = summarizeTarget(secondRows, targets[1], endYear);
    if (!firstStart || !firstEnd || !secondStart || !secondEnd) {
      return missingYearReply();
    }

    const periodLine = (target: PlaceTarget, start: DataRow, end: DataRow) => {
      const pmChange =
        start.pm25 !== undefined && end.pm25 !== undefined
          ? end.pm25 - start.pm25
          : undefined;
      const startLoss = lifeLoss(start, benchmark);
      const endLoss = lifeLoss(end, benchmark);
      const lossChange =
        startLoss !== undefined && endLoss !== undefined
          ? endLoss - startLoss
          : undefined;
      const metrics = [
        pmChange !== undefined && start.pm25 !== undefined && end.pm25 !== undefined
          ? `PM2.5 ${formatNumber(start.pm25)} → ${formatNumber(end.pm25)} µg/m³ (${formatSigned(pmChange)})`
          : undefined,
        lossChange !== undefined && startLoss !== undefined && endLoss !== undefined
          ? `life loss ${formatNumber(startLoss)} → ${formatNumber(endLoss)} years (${formatSigned(lossChange)})`
          : undefined,
      ].filter(Boolean);
      return `- ${target.value}: ${metrics.join("; ")}`;
    };
    const firstChange = firstEnd.pm25! - firstStart.pm25!;
    const secondChange = secondEnd.pm25! - secondStart.pm25!;
    const endDifference = Math.abs(firstEnd.pm25! - secondEnd.pm25!);
    const endHigher = firstEnd.pm25! >= secondEnd.pm25!
      ? targets[0].value
      : targets[1].value;
    const movementComparison = comparePeriodMovements(
      targets[0].value,
      firstChange,
      targets[1].value,
      secondChange
    );
    return `Comparison from ${startYear} to ${endYear} (${benchmarkLabel(benchmark)}):${levelNote ? `\n${levelNote}` : ""}\n${periodLine(targets[0], firstStart, firstEnd)}\n${periodLine(targets[1], secondStart, secondEnd)}\n\nBy ${endYear}, ${endHigher} had ${formatNumber(endDifference)} µg/m³ higher PM2.5. ${movementComparison}`;
  }

  const requestedYear = years.at(-1);
  const year =
    requestedYear ??
    commonYearList.at(-1)!;
  if (!Number.isFinite(year)) {
    return requestedYear !== undefined ? missingYearReply() : CSV_NO_DATA_REPLY;
  }

  const first = summarizeTarget(firstRows, targets[0], year);
  const second = summarizeTarget(secondRows, targets[1], year);
  if (!first || !second) {
    return requestedYear !== undefined ? missingYearReply() : CSV_NO_DATA_REPLY;
  }

  const firstLoss = lifeLoss(first, benchmark);
  const secondLoss = lifeLoss(second, benchmark);
  const firstSummary = formatPlaceMetrics(targets[0].value, first, firstLoss);
  const secondSummary = formatPlaceMetrics(targets[1].value, second, secondLoss);
  const differences: string[] = [];
  let pm25Higher: string | undefined;
  let pm25Difference: number | undefined;
  let lossHigher: string | undefined;
  let lossDifference: number | undefined;

  if (first.pm25 !== undefined && second.pm25 !== undefined) {
    pm25Higher = first.pm25 >= second.pm25 ? targets[0].value : targets[1].value;
    pm25Difference = Math.abs(first.pm25 - second.pm25);
  }
  if (firstLoss !== undefined && secondLoss !== undefined) {
    lossHigher = firstLoss >= secondLoss ? targets[0].value : targets[1].value;
    lossDifference = Math.abs(firstLoss - secondLoss);
  }

  if (
    pm25Higher &&
    lossHigher &&
    pm25Higher === lossHigher &&
    pm25Difference !== undefined &&
    lossDifference !== undefined
  ) {
    differences.push(
      `${pm25Higher} has ${formatNumber(pm25Difference)} µg/m³ higher PM2.5 and ${formatNumber(lossDifference)} more years of life loss`
    );
  } else {
    if (pm25Higher && pm25Difference !== undefined) {
      differences.push(
        `${pm25Higher} has ${formatNumber(pm25Difference)} µg/m³ higher PM2.5`
      );
    }
    if (lossHigher && lossDifference !== undefined) {
      differences.push(
        `${lossHigher} has ${formatNumber(lossDifference)} more years of life loss`
      );
    }
  }

  return `Using ${year} and ${benchmarkLabel(benchmark)}:${levelNote ? `\n${levelNote}` : ""}\n- ${firstSummary}\n- ${secondSummary}${
    differences.length ? `\nDifference: ${differences.join(" and ")}.` : ""
  }`;
}

function comparisonLevelNote(targets: PlaceTarget[]): string | undefined {
  if (targets[0].level === targets[1].level) return undefined;
  return `Level note: ${targets[0].value} uses ${csvLevelLabel(csvLevelForGeography(targets[0].level))} ${targets[0].level}-level data; ${targets[1].value} uses ${csvLevelLabel(csvLevelForGeography(targets[1].level))} ${targets[1].level}-level data.`;
}

function comparisonSourceLabel(targets: PlaceTarget[]): string | undefined {
  const levels = Array.from(
    new Set(
      targets
        .slice(0, 2)
        .map((target) => csvLevelForGeography(target.level))
    )
  ).sort((left, right) => left.localeCompare(right));
  if (levels.length === 0) return undefined;
  return levels.map((level) => `${csvLevelLabel(level)} CSV`).join(" + ");
}

function comparePeriodMovements(
  firstPlace: string,
  firstChange: number,
  secondPlace: string,
  secondChange: number
): string {
  const difference = Math.abs(firstChange - secondChange);
  if (firstChange <= 0 && secondChange <= 0) {
    const improvedMore = firstChange <= secondChange ? firstPlace : secondPlace;
    return `${improvedMore} improved ${formatNumber(difference)} µg/m³ more over the period.`;
  }
  if (firstChange >= 0 && secondChange >= 0) {
    const worsenedMore = firstChange >= secondChange ? firstPlace : secondPlace;
    return `${worsenedMore} worsened ${formatNumber(difference)} µg/m³ more over the period.`;
  }
  const improved = firstChange < 0 ? firstPlace : secondPlace;
  const worsened = firstChange > 0 ? firstPlace : secondPlace;
  return `${improved} improved while ${worsened} worsened over the period.`;
}

function answerPeakChange(
  query: string,
  rows: DataRow[],
  benchmark: Benchmark
): string {
  const target = mostSpecificTarget(findPlaceTargets(query, rows));
  if (!target) return "Which place should I check for the largest change?";

  const targetRows = rowsForTarget(rows, target);
  const availableYears = Array.from(
    new Set(targetRows.map((row) => row.year).filter(isNumber))
  ).sort((left, right) => left - right);
  if (availableYears.length < 2) return CSV_NO_DATA_REPLY;

  const relativeRange = relativeYearRange(query, availableYears);
  const startYear = relativeRange?.[0] ?? availableYears[0];
  const endYear = relativeRange?.[1] ?? availableYears[availableYears.length - 1];
  const summaries = availableYears
    .filter((year) => year >= startYear && year <= endYear)
    .map((year) => summarizeTarget(targetRows, target, year))
    .filter((row): row is DataRow => row?.pm25 !== undefined);
  if (summaries.length < 2) return CSV_NO_DATA_REPLY;

  const changes = summaries.slice(1).map((end, index) => {
    const start = summaries[index];
    const startLoss = lifeLoss(start, benchmark);
    const endLoss = lifeLoss(end, benchmark);
    return {
      start,
      end,
      change: end.pm25! - start.pm25!,
      lossChange:
        startLoss !== undefined && endLoss !== undefined
          ? endLoss - startLoss
          : undefined,
    };
  });
  const seeksDecrease = /\bdecrease\b/i.test(query);
  changes.sort((left, right) =>
    seeksDecrease ? left.change - right.change : right.change - left.change
  );
  const peak = changes[0];
  const direction = seeksDecrease ? "decrease" : "increase";
  return `Largest annual PM2.5 ${direction} for ${target.value}, ${startYear}–${endYear}:\n- ${peak.start.year} to ${peak.end.year}: ${formatNumber(peak.start.pm25!)} → ${formatNumber(peak.end.pm25!)} µg/m³\n- Change: ${formatSigned(peak.change)} µg/m³${peak.lossChange !== undefined ? `\n- Life loss change: ${formatSigned(peak.lossChange)} years` : ""}`;
}

function answerPeakValue(
  query: string,
  rows: DataRow[],
  benchmark: Benchmark
): string {
  const target = mostSpecificTarget(findPlaceTargets(query, rows));
  if (!target) return "Which country or state/province should I check?";

  const targetRows = rowsForTarget(rows, target);
  const availableYears = Array.from(
    new Set(targetRows.map((row) => row.year).filter(isNumber))
  ).sort((left, right) => left - right);
  if (availableYears.length === 0) return CSV_NO_DATA_REPLY;

  const explicitYears = requestedYears(query);
  const relativeRange = relativeYearRange(query, availableYears);
  const startYear = relativeRange?.[0] ?? explicitYears[0] ?? availableYears[0];
  const endYear = relativeRange?.[1] ?? explicitYears[1] ?? availableYears.at(-1)!;
  const summaries = availableYears
    .filter((year) => year >= startYear && year <= endYear)
    .map((year) => summarizeTarget(targetRows, target, year))
    .filter((row): row is DataRow => row?.pm25 !== undefined);
  if (summaries.length === 0) return missingYearReply();

  const seeksLowest = /\b(?:lowest|minimum|min)\b/i.test(query);
  summaries.sort((left, right) =>
    seeksLowest ? left.pm25! - right.pm25! : right.pm25! - left.pm25!
  );
  const result = summaries[0];
  const loss = lifeLoss(result, benchmark);
  return `${seeksLowest ? "Lowest" : "Highest"} PM2.5 for ${target.value}, ${startYear}–${endYear}:\n- ${result.year}: ${formatNumber(result.pm25!)} µg/m³${loss !== undefined ? `\n- Life loss: ${formatNumber(loss)} years per person (${benchmarkLabel(benchmark)})` : ""}`;
}

function answerTrend(
  query: string,
  rows: DataRow[],
  benchmark: Benchmark,
  currentQuery: string
): string {
  const target = mostSpecificTarget(findPlaceTargets(query, rows));
  if (!target) return "Which place should I show the trend for?";

  const targetRows = rowsForTarget(rows, target);
  const availableYears = Array.from(
    new Set(targetRows.map((row) => row.year).filter(isNumber))
  ).sort((left, right) => left - right);
  if (availableYears.length < 2) return CSV_NO_DATA_REPLY;

  const years = questionYears(query, currentQuery);
  const relativeRange = relativeYearRange(query, availableYears);
  const startYear = years[0] ?? relativeRange?.[0] ?? availableYears[0];
  const endYear =
    years[1] ?? relativeRange?.[1] ?? availableYears[availableYears.length - 1];
  const start = summarizeTarget(targetRows, target, startYear);
  const end = summarizeTarget(targetRows, target, endYear);
  if (!start || !end) return years.length ? missingYearReply() : CSV_NO_DATA_REPLY;

  const startLoss = lifeLoss(start, benchmark);
  const endLoss = lifeLoss(end, benchmark);
  const lines = [`From ${startYear} to ${endYear} for ${target.value}:`];
  if (start.pm25 !== undefined && end.pm25 !== undefined) {
    const change = end.pm25 - start.pm25;
    lines.push(
      `- PM2.5 changed from ${formatNumber(start.pm25)} to ${formatNumber(end.pm25)} µg/m³`,
      `- Change: ${formatSigned(change)} µg/m³`
    );
  }
  if (startLoss !== undefined && endLoss !== undefined) {
    lines.push(
      `- Life loss changed from ${formatNumber(startLoss)} to ${formatNumber(endLoss)} years`
    );
  }
  if (start.pm25 !== undefined && end.pm25 !== undefined) {
    lines.push(
      `- Direction: ${end.pm25 > start.pm25 ? "worsened" : end.pm25 < start.pm25 ? "improved" : "unchanged"}`,
      `\nThis suggests long-term exposure ${end.pm25 > start.pm25 ? "worsened" : end.pm25 < start.pm25 ? "improved" : "was unchanged"} over the period.`
    );
  }
  return lines.length > 1 ? lines.join("\n") : CSV_NO_DATA_REPLY;
}

function answerDirectValue(
  query: string,
  rows: DataRow[],
  benchmark: Benchmark,
  currentQuery: string
): string {
  const targets = findPlaceTargets(query, rows);
  const target = mostSpecificTarget(targets);
  if (!target) {
    return hasUnmatchedPlaceWords(query)
      ? "I could not find that location in the current dataset. Please check the spelling or provide the state/country name."
      : "Which place should I check? Please provide a country or state/province.";
  }

  const matchingRows = rowsForTarget(rows, target);
  if (isAmbiguousTarget(target, matchingRows, targets)) {
    return `Which ${target.value} do you mean? Please include its state or country.`;
  }

  const requestedYear = questionYears(query, currentQuery).at(-1);
  const year = requestedYear ?? latestYear(matchingRows);
  if (year === undefined) return CSV_NO_DATA_REPLY;
  const summary = summarizeTarget(matchingRows, target, year);
  if (!summary) {
    return requestedYear !== undefined ? missingYearReply() : CSV_NO_DATA_REPLY;
  }

  if (/\bpopulation\b/i.test(currentQuery) && !isTotalLifeYearsQuery(currentQuery)) {
    return summary.population === undefined
      ? CSV_NO_DATA_REPLY
      : `${target.value}, ${year}: population ${formatInteger(summary.population)}.`;
  }

  const bothBenchmarks = wantsBothBenchmarks(query);
  const totalLifeYears = isTotalLifeYearsQuery(query);
  if (bothBenchmarks || totalLifeYears) {
    const whoLoss = lifeLoss(summary, { type: "who", target: 5 });
    const nationalLoss = lifeLoss(summary, { type: "national" });
    const selectedLoss = lifeLoss(summary, benchmark);
    const lines = [`${target.value}, ${year}:`];
    if (summary.pm25 !== undefined) {
      lines.push(`- PM2.5: ${formatNumber(summary.pm25)} µg/m³`);
    }
    if (totalLifeYears) {
      if (summary.population === undefined || summary.population <= 0) {
        return CSV_NO_DATA_REPLY;
      }
      lines.push(`- Population: ${formatInteger(summary.population)} people`);
      const addTotal = (label: string, loss: number | undefined) => {
        if (loss === undefined) return;
        lines.push(
          `- ${label}: ${formatNumber(loss)} years per person; ${formatInteger(loss * summary.population!)} total person-years lost`
        );
      };
      if (bothBenchmarks) {
        addTotal("WHO guideline", whoLoss);
        addTotal("National standard", nationalLoss);
      } else {
        addTotal(
          benchmark.type === "national" ? "National standard" : "WHO guideline",
          selectedLoss
        );
      }
      lines.push("- Calculation: life loss per person × population");
    } else {
      if (whoLoss !== undefined) {
        lines.push(`- WHO guideline: ${formatNumber(whoLoss)} years life loss per person`);
      }
      if (nationalLoss !== undefined) {
        lines.push(`- National standard: ${formatNumber(nationalLoss)} years life loss per person`);
      }
    }
    return lines.length > 1 ? lines.join("\n") : CSV_NO_DATA_REPLY;
  }

  const loss = lifeLoss(summary, benchmark);
  const metrics: string[] = [];
  if (summary.pm25 !== undefined) {
    metrics.push(`${formatNumber(summary.pm25)} µg/m³ PM2.5`);
  }
  if (loss !== undefined) {
    metrics.push(`${formatNumber(loss)} years of life loss`);
  }
  if (metrics.length === 0) return CSV_NO_DATA_REPLY;
  const averageNote = summary.usedSimpleAverage
    ? "\nUsing a simple average because population weights are not available."
    : "";
  return `${target.value}, ${year} (${benchmarkLabel(benchmark)}): ${metrics.join(", ")}.${averageNote}`;
}

function inferLevel(query: string): GeographyLevel | undefined {
  if (/\bdistricts?|counties|county\b/i.test(query)) return "district";
  if (/\bstates?|provinces?\b/i.test(query)) return "state";
  if (/\bcountries|country|nations?\b/i.test(query)) return "country";
  if (/\bregions?\b/i.test(query)) return "region";
  return undefined;
}

function inferQuestionLevel(query: string): GeographyLevel | undefined {
  if (/^\s*only in (?:this|that|the same) (?:state|province|country|region)\b/i.test(query)) {
    return undefined;
  }
  if (/^\s*(?:among|across) all (?:the )?(?:countries|world)\b/i.test(query)) {
    return undefined;
  }
  return inferLevel(query);
}

function isGlobalScope(query: string): boolean {
  return /\b(?:global|globally|world\s*wide|whole world|the world|across the world|all (?:the )?countries|among all (?:the )?countries)\b/i.test(
    query
  );
}

function detectIntent(
  query: string
): "ranking" | "comparison" | "trend" | undefined {
  if (
    /\b(highest|lowest|top|bottom|rank|ranking|most|least|best|worst|improved|improvement|worsened|worsening)\b/i.test(query) ||
    /\b(?:each|all)\s+(?:of\s+the\s+)?(?:countries|states?|provinces?|districts?)\b/i.test(query) ||
    /\blist\s+(?:of\s+)?(?:countries|states?|provinces?|districts?)\b/i.test(query)
  ) {
    return "ranking";
  }
  if (/\b(compare|comparison|difference|versus|vs\.?|between)\b/i.test(query)) {
    return "comparison";
  }
  if (/\b(trend|change|changed|increase|decrease|over time|from \d{4}|show trend)\b/i.test(query)) {
    return "trend";
  }
  return undefined;
}

function resolveDataIntent(
  currentQuery: string,
  resolvedQuery: string,
  targets: PlaceTarget[]
): DataIntent | undefined {
  if (isThresholdFilterQuery(currentQuery) || isThresholdFilterQuery(resolvedQuery)) {
    return "threshold_filter";
  }
  if (
    asksForAnnualLeader(currentQuery) &&
    /\b(?:highest|lowest|top|bottom|most|least|best|worst|polluted|cleanest)\b/i.test(
      currentQuery
    )
  ) {
    return "ranking";
  }
  if (
    targets.length >= 2 &&
    /\b(?:and|versus|vs\.?)\b/i.test(currentQuery) &&
    /\b(?:pm\s*2\.?5|pollution|life\s+(?:year\s+)?loss|life expectancy|llpp|population|standard|std)\b/i.test(
      currentQuery
    ) &&
    !/\b(?:top|bottom|rank|ranking|highest|lowest|most|least|best|worst)\b/i.test(
      currentQuery
    )
  ) {
    return "comparison";
  }
  const currentYears = requestedYears(currentQuery);
  if (
    currentYears.length >= 2 &&
    targets.length > 0 &&
    /\b(compare|comparison|difference|change|from)\b/i.test(currentQuery)
  ) {
    return targets.length >= 2 ? "comparison" : "trend";
  }

  if (
    currentYears.length === 1 &&
    targets.length > 0 &&
    /\bcompare\s+(?:this|that|it|the same)|\b(?:this|that|it)\b[\s\S]*\b(?:in|with|from)\s+(?:19|20)\d{2}\b/i.test(
      currentQuery
    )
  ) {
    return "trend";
  }

  if (
    targets.length > 0 &&
    /\b(?:highest|largest|biggest|maximum|max)\s+(?:annual\s+)?(?:rise|increase|decrease)\b/i.test(
      currentQuery
    ) &&
    !/\bwhich\s+(?:country|state|province|district|region)\b/i.test(currentQuery)
  ) {
    return "peak_change";
  }

  if (
    targets.length > 0 &&
    /\b(?:last\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|\d{1,2})(?:\s+years?)?|last\s+decade|since\s+(?:19|20)\d{2}|between\s+(?:19|20)\d{2})\b/i.test(
      currentQuery
    ) &&
    /(?:\b(?:highest|maximum|max|lowest|minimum|min)\b[\s\S]*\b(?:pm\s*2\.?5|pm|pollution)\b|\b(?:pm\s*2\.?5|pm|pollution)\b[\s\S]*\b(?:highest|maximum|max|lowest|minimum|min)\b)/i.test(
      currentQuery
    )
  ) {
    return "peak_value";
  }

  return detectIntent(currentQuery) ?? detectIntent(resolvedQuery);
}

function isThresholdFilterQuery(query: string): boolean {
  return parseNumericCondition(query) !== undefined;
}

function hasUnmatchedPlaceWords(query: string): boolean {
  return normalizePlace(query)
    .split(" ")
    .some(
      (word) =>
        word.length > 1 &&
        !NON_PLACE_QUERY_WORDS.has(word) &&
        !/^(?:19|20)\d{2}$/.test(word) &&
        !/^\d+(?:\.\d+)?$/.test(word)
    );
}

function findPlaceTargets(
  query: string,
  rows: DataRow[],
  constrainToExplicitLevel = true
): PlaceTarget[] {
  const explicitLevel = constrainToExplicitLevel ? inferLevel(query) : undefined;
  const queryWords = normalizePlace(query).split(" ").filter(Boolean);
  const seen = new Set<string>();
  const matches: PlaceTarget[] = [];

  for (const level of [...LEVELS].reverse()) {
    for (const row of rows) {
      const value = row[level];
      if (!value || (explicitLevel && level !== explicitLevel)) continue;
      const key = `${level}:${normalizePlace(value)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const matchQuality = placeMatchQuality(query, queryWords, value);
      if (matchQuality === 0) continue;
      matches.push({
        level,
        value,
        matchQuality,
        position: placeMentionPosition(query, value),
      });
    }
  }
  const sorted = matches.sort(
    (left, right) =>
      right.matchQuality - left.matchQuality ||
      normalizePlace(right.value).split(" ").length -
        normalizePlace(left.value).split(" ").length ||
      levelPriority(right.level) - levelPriority(left.level) ||
      right.value.length - left.value.length
  );
  const withoutGenericLabels = sorted.filter(
    (target) => normalizePlace(target.value) !== "capital"
  );
  return withoutGenericLabels.length ? withoutGenericLabels : sorted;
}

function placeMentionPosition(query: string, place: string): number {
  const normalizedQuery = normalizePlace(query);
  const normalizedPlace = normalizePlace(place);
  const fullPosition = normalizedQuery.indexOf(normalizedPlace);
  if (fullPosition >= 0) return fullPosition;
  const compactPlace = normalizedPlace.replace(/\s/g, "");
  const compactWordPosition = normalizedQuery
    .split(" ")
    .findIndex((word) => word === compactPlace);
  if (compactWordPosition >= 0) return compactWordPosition;

  const ignored = new Set(["of", "the", "nct", "state", "province", "district"]);
  const positions = normalizedPlace
    .split(" ")
    .filter((word) => word && !ignored.has(word))
    .map((word) => normalizedQuery.indexOf(word))
    .filter((position) => position >= 0);
  return positions.length ? Math.min(...positions) : Number.MAX_SAFE_INTEGER;
}

function placeMatchQuality(
  query: string,
  queryWords: string[],
  place: string
): number {
  const normalizedQuery = normalizePlace(query);
  const normalizedPlace = normalizePlace(place);
  if (!normalizedPlace) return 0;
  if (` ${normalizedQuery} `.includes(` ${normalizedPlace} `)) return 3;

  const compactPlace = normalizedPlace.replace(/\s/g, "");
  if (
    normalizedPlace.includes(" ") &&
    queryWords.some((queryWord) => queryWord === compactPlace)
  ) {
    return 3;
  }

  const placeWords = normalizedPlace
    .split(" ")
    .filter(
      (word) =>
        word && !["of", "the", "nct", "state", "province", "district"].includes(word)
    );
  if (
    placeWords.length > 0 &&
    placeWords.every((placeWord) => queryWords.includes(placeWord))
  ) {
    return 2;
  }
  if (
    placeWords.length > 0 &&
    placeWords.every((placeWord) =>
      queryWords.some((queryWord) => searchTokensMatch(queryWord, placeWord))
    )
  ) {
    return 1;
  }
  return 0;
}

function rowsForTarget(rows: DataRow[], target: PlaceTarget): DataRow[] {
  const normalizedTarget = normalizePlace(target.value);
  return rows.filter(
    (row) => normalizePlace(row[target.level] ?? "") === normalizedTarget
  );
}

function summarizeTarget(
  rows: DataRow[],
  target: PlaceTarget,
  year: number
): DataRow | undefined {
  const inYear = rows.filter((row) => row.year === year);
  if (inYear.length === 0) return undefined;
  const exact = inYear.filter((row) => isExactLevel(row, target.level));
  return aggregateRows(exact.length ? exact : inYear, target.level, target.value, year);
}

function summarizeByLevel(
  rows: DataRow[],
  level: GeographyLevel
): DataRow[] {
  const groups = new Map<string, { label: string; rows: DataRow[] }>();
  for (const row of rows) {
    const label = row[level];
    if (!label || !isUsablePlaceLabel(label)) continue;
    const key = rankingPlaceKey(row, level);
    const group = groups.get(key) ?? { label, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }

  return Array.from(groups.values()).map(({ label, rows: groupRows }) => {
    const exact = groupRows.filter((row) => isExactLevel(row, level));
    const result = aggregateRows(
      exact.length ? exact : groupRows,
      level,
      label,
      groupRows[0]?.year
    );
    result.region = groupRows[0]?.region;
    result.country = groupRows[0]?.country;
    result.state = groupRows[0]?.state;
    result.district = groupRows[0]?.district;
    result[level] = label;
    return result;
  });
}

function summarizePeriodByLevel(
  rows: DataRow[],
  level: GeographyLevel
): DataRow[] {
  const years = Array.from(new Set(rows.map((row) => row.year).filter(isNumber)));
  const annualRows = years.flatMap((year) =>
    summarizeByLevel(
      rows.filter((row) => row.year === year && row[level]),
      level
    )
  );
  const groups = new Map<string, DataRow[]>();
  for (const row of annualRows) {
    const key = rankingPlaceKey(row, level);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  return Array.from(groups.values()).map((group) => {
    const latest = [...group].sort((a, b) => (b.year ?? 0) - (a.year ?? 0))[0];
    const result: DataRow = {
      region: latest.region,
      country: latest.country,
      state: latest.state,
      district: latest.district,
      population: latest.population,
      csvLevel: latest.csvLevel,
    };
    result[level] = latest[level];
    for (const field of [
      "pm25",
      "llpp",
      "llppWho",
      "llppNational",
      "whoStandard",
      "nationalStandard",
    ] as const) {
      const values = group.map((row) => row[field]).filter(isNumber);
      if (values.length) {
        result[field] = values.reduce((sum, value) => sum + value, 0) / values.length;
      }
    }
    return result;
  });
}

function aggregateRows(
  rows: DataRow[],
  level: GeographyLevel,
  label: string,
  year?: number
): DataRow {
  const result: DataRow = { [level]: label, year };
  if (
    rows.length > 1 &&
    rows.some((row) => row.population === undefined || row.population <= 0)
  ) {
    result.usedSimpleAverage = true;
  }
  for (const field of [
    "pm25",
    "llpp",
    "llppWho",
    "llppNational",
    "whoStandard",
    "nationalStandard",
  ] as const) {
    const value = weightedAverage(rows, field);
    if (value !== undefined) result[field] = value;
  }
  const populations = rows.map((row) => row.population).filter(isNumber);
  if (populations.length) {
    result.population = populations.reduce((sum, value) => sum + value, 0);
  }
  return result;
}

function weightedAverage(
  rows: DataRow[],
  field:
    | "pm25"
    | "llpp"
    | "llppWho"
    | "llppNational"
    | "whoStandard"
    | "nationalStandard"
): number | undefined {
  const withValue = rows.filter((row) => row[field] !== undefined);
  if (withValue.length === 0) return undefined;
  const withPopulation = withValue.filter(
    (row) => row.population !== undefined && row.population! > 0
  );
  if (withPopulation.length === withValue.length) {
    const population = withPopulation.reduce(
      (sum, row) => sum + row.population!,
      0
    );
    return withPopulation.reduce(
      (sum, row) => sum + row[field]! * row.population!,
      0
    ) / population;
  }
  return withValue.reduce((sum, row) => sum + row[field]!, 0) / withValue.length;
}

function lifeLoss(row: DataRow, benchmark: Benchmark): number | undefined {
  if (benchmark.type === "who") {
    return (
      row.llppWho ??
      row.llpp ??
      calculateLoss(row.pm25, row.whoStandard ?? benchmark.target)
    );
  }
  if (benchmark.type === "national") {
    return (
      row.llppNational ?? calculateLoss(row.pm25, row.nationalStandard)
    );
  }
  return calculateLoss(row.pm25, benchmark.target);
}

function calculateLoss(pm25?: number, target?: number): number | undefined {
  if (pm25 === undefined || target === undefined) return undefined;
  return Math.max(pm25 - target, 0) * 0.098;
}

function parseBenchmark(query: string): Benchmark {
  const selections: Array<{ index: number; benchmark: Benchmark }> = [];
  for (const match of query.matchAll(
    /\b(?:custom\s+)?(?:target|benchmark)(?:\s+of|\s*=|:)?\s*(\d+(?:\.\d+)?)\s*(?:µg|μg|ug|micrograms?)/gi
  )) {
    selections.push({
      index: match.index,
      benchmark: { type: "custom", target: Number(match[1]) },
    });
  }
  for (const match of query.matchAll(
    /\b(?:national(?: pm\s*2\.?5)?\s*(?:standards?|std|limit)|nat[_\s-]*(?:std|standard|limit))\b/gi
  )) {
    selections.push({ index: match.index, benchmark: { type: "national" } });
  }
  for (const match of query.matchAll(/\bWHO(?: guideline)?\b/g)) {
    selections.push({
      index: match.index,
      benchmark: { type: "who", target: 5 },
    });
  }
  for (const match of query.matchAll(/\bwho guideline\b/gi)) {
    selections.push({
      index: match.index,
      benchmark: { type: "who", target: 5 },
    });
  }
  return selections.sort((left, right) => right.index - left.index)[0]?.benchmark ?? {
    type: "who",
    target: 5,
  };
}

function benchmarkLabel(benchmark: Benchmark): string {
  if (benchmark.type === "national") return "the national PM2.5 standard";
  if (benchmark.type === "custom") {
    return `a ${formatNumber(benchmark.target)} µg/m³ target`;
  }
  return "the WHO guideline";
}

function formatPlaceMetrics(
  label: string,
  row: DataRow,
  loss?: number
): string {
  const metrics: string[] = [];
  if (row.pm25 !== undefined) metrics.push(`${formatNumber(row.pm25)} µg/m³`);
  if (loss !== undefined) metrics.push(`${formatNumber(loss)} years life loss`);
  return `${label}: ${metrics.join(", ")}`;
}

function isExactLevel(row: DataRow, level: GeographyLevel): boolean {
  if (level === "region") return !row.country && !row.state && !row.district;
  if (level === "country") return !row.state && !row.district;
  if (level === "state") return !row.district;
  return true;
}

function isAmbiguousTarget(
  target: PlaceTarget,
  rows: DataRow[],
  mentionedTargets: PlaceTarget[]
): boolean {
  if (target.level !== "district" && target.level !== "state") return false;
  const parentField = target.level === "district" ? "state" : "country";
  const parents = new Set(rows.map((row) => row[parentField]).filter(Boolean));
  if (parents.size <= 1) return false;
  return !mentionedTargets.some((candidate) => candidate.level === parentField);
}

function mostSpecificTarget(targets: PlaceTarget[]): PlaceTarget | undefined {
  return [...targets].sort(
    (left, right) =>
      right.matchQuality - left.matchQuality ||
      normalizePlace(right.value).split(" ").length -
        normalizePlace(left.value).split(" ").length ||
      levelPriority(right.level) - levelPriority(left.level) ||
      right.value.length - left.value.length
  )[0];
}

function levelPriority(level: GeographyLevel): number {
  return LEVELS.indexOf(level);
}

function latestYear(rows: DataRow[]): number | undefined {
  const years = rows.map((row) => row.year).filter(isNumber);
  return years.length ? Math.max(...years) : undefined;
}

function questionYears(query: string, currentQuery: string): number[] {
  if (/\blatest(?: available)? year\b/i.test(currentQuery)) return [];
  const currentYears = requestedYears(currentQuery);
  return currentYears.length ? currentYears : requestedYears(query);
}

function hasBenchmarkSelection(query: string): boolean {
  return (
    hasWhoBenchmark(query) ||
    /\b(national(?: PM\s*2\.?5)?\s*(?:standards?|std|limit)|nat[_\s-]*(?:std|standard|limit)|custom\s+(?:target|benchmark)|(?:target|benchmark)\s*(?:of|=|:)?\s*\d+)\b/i.test(
      query
    )
  );
}

function wantsBothBenchmarks(query: string): boolean {
  return (
    hasWhoBenchmark(query) && hasNationalBenchmark(query)
  );
}

function hasWhoBenchmark(query: string): boolean {
  return /\bWHO\b/.test(query) || /\bwho (?:guideline|standard)\b/i.test(query);
}

function hasNationalBenchmark(query: string): boolean {
  return /\b(?:national(?: PM\s*2\.?5)?\s*(?:standards?|std|limit)|nat[_\s-]*(?:std|standard|limit))\b/i.test(
    query
  );
}

function isTotalLifeYearsQuery(query: string): boolean {
  return /\b(?:total\s+life\s+years?\s+loss|total\s+years?\s+of\s+life\s+lost|total\s+life[- ]years?\s+lost)\b/i.test(
    query
  );
}

function isTotalLifeYearsDefinition(query: string): boolean {
  return (
    isTotalLifeYearsQuery(query) &&
    /\b(?:means?|multiply|multiplied|population)\b/i.test(query) &&
    !/\b(?:in|for)\s+(?!the\b)(?:[A-Z][\p{L}'’-]+)\b/u.test(query)
  );
}

function csvLevelForGeography(level: GeographyLevel): CsvDatasetLevel {
  if (level === "district") return "gadm2";
  if (level === "state") return "gadm1";
  return "gadm0";
}

function rankingPlaceKey(row: DataRow, level: GeographyLevel): string {
  const parts =
    level === "region"
      ? [row.region]
      : level === "country"
        ? [row.region, row.country]
        : level === "state"
          ? [row.country, row.state]
          : [row.country, row.state, row.district];
  return parts.map((part) => normalizePlace(part ?? "")).join("|");
}

function rankingPlaceLabel(
  row: DataRow,
  level: GeographyLevel,
  includeParent = false
): string {
  const place = row[level] ?? "Unknown";
  if (level === "district" && row.state) {
    return [place, row.state, includeParent ? row.country : undefined]
      .filter(Boolean)
      .join(", ");
  }
  if (level === "state" && includeParent && row.country) {
    return `${place}, ${row.country}`;
  }
  return place;
}

function isUsablePlaceLabel(value: string): boolean {
  return !/^(?:na|n\/a|null|none|unknown|-)$/i.test(value.trim());
}

function missingYearReply(): string {
  return "I don’t have data for that year in the current CSV.";
}

function withReference(
  answer: string,
  level: CsvDatasetLevel | undefined,
  benchmark: Benchmark | undefined,
  options: CsvQuestionOptions,
  resolvedQuery = options.currentQuery ?? "",
  sourceOverride?: string
): string {
  if (/\nReference(?: checked)?:/i.test(answer)) return answer;

  const source = sourceOverride ?? (level ? `${csvLevelLabel(level)} CSV` : "current GADM CSV files");
  const checked =
    !level ||
    /^(?:I don’t|I could not|Which|Do you|These places|Sure\.)/i.test(answer);
  if (checked) return `${answer}\n\nReference checked: ${source}.`;

  const contextPrefix = options.usedConversationContext
    ? "Previous conversation context + "
    : "";
  const years = questionYears(resolvedQuery, options.currentQuery ?? resolvedQuery);
  const reportedRange =
    answer.match(/\b((?:19|20)\d{2})[–-]((?:19|20)\d{2})\b/) ??
    answer.match(/\bfrom ((?:19|20)\d{2}) to ((?:19|20)\d{2})\b/i);
  const isTrend = /\b(trend|change|changed|increase|rise|decrease|improved|worsened|from \d{4})\b/i.test(
    options.currentQuery ?? resolvedQuery
  );
  const yearLabel =
    reportedRange
      ? `${reportedRange[1]}–${reportedRange[2]}`
      : isTrend && years.length >= 2
        ? `${years[0]}–${years[1]}`
        : years.at(-1)?.toString() ?? "latest available year";
  const numericCondition =
    parseNumericCondition(options.currentQuery ?? "") ??
    parseNumericCondition(resolvedQuery);
  const benchmarkText = numericCondition
    ? numericCondition.metric === "llppWho"
      ? "WHO guideline benchmark"
      : numericCondition.metric === "llppNational"
        ? "national standard benchmark"
        : numericCondition.metric === "nationalStandard"
          ? "national standard field"
          : numericCondition.metric === "whoStandard"
            ? "WHO guideline field"
            : undefined
    : wantsBothBenchmarks(resolvedQuery)
      ? "WHO guideline and national standard benchmarks"
      : benchmark
      ? benchmark.type === "national"
      ? "national standard benchmark"
      : benchmark.type === "custom"
        ? "custom PM2.5 target provided by user"
        : "WHO guideline benchmark"
        : undefined;
  const details = [yearLabel, benchmarkText].filter(Boolean).join(", ");
  const suggestion = csvSuggestion(answer, level);
  return `${answer}${suggestion ? `\n\n${suggestion}` : ""}\n\nReference: ${contextPrefix}${source}${details ? `, ${details}` : ""}.`;
}

function csvSuggestion(
  answer: string,
  level: CsvDatasetLevel | undefined
): string | undefined {
  const annualLeader = answer.match(/^\d{4}: (.+?) —/m)?.[1];
  if (annualLeader) {
    return `You can also ask: “Show the trend for ${annualLeader}.”`;
  }

  const peakValuePlace = answer.match(
    /^(?:Highest|Lowest) PM2\.5 for (.+?), \d{4}–\d{4}:/m
  )?.[1];
  if (peakValuePlace) {
    return `You can also ask: “Show the full trend for ${peakValuePlace}.”`;
  }

  const rankedPlace = answer.match(/^1\. (.+?) —/m)?.[1];
  if (rankedPlace) {
    return `You can also ask: “Show the trend for ${rankedPlace}.”`;
  }

  const trendPlace = answer.match(/^From \d{4} to \d{4} for (.+?):/m)?.[1];
  if (trendPlace) {
    return `You can also ask: “Compare ${trendPlace} with another ${level === "gadm0" ? "country" : "state"}.”`;
  }

  const peakPlace = answer.match(
    /^Largest annual PM2\.5 (?:increase|decrease) for (.+?), \d{4}–\d{4}:/m
  )?.[1];
  if (peakPlace) {
    return `You can also ask: “Show the full trend for ${peakPlace}.”`;
  }


  const directPlace = answer.match(/^([^,\n]+), \d{4}/m)?.[1];
  if (directPlace) {
    return `You can also ask: “Show the trend for ${directPlace}.”`;
  }

  const comparedPlace = answer.match(/^- (.+?):/m)?.[1];
  if (comparedPlace) {
    return `You can also ask: “Show the trend for ${comparedPlace}.”`;
  }

  return undefined;
}

function requestedYears(query: string): number[] {
  return Array.from(query.matchAll(/\b(?:19|20)\d{2}\b/g), (match) =>
    Number(match[0])
  );
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  twenty: 20,
};

function parseRequestedCount(query: string): number {
  const amount = "\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten";
  const value =
    query.match(new RegExp(`\\b(?:top|bottom|highest|lowest)\\s+(${amount})\\b`, "i"))?.[1] ??
    query.match(new RegExp(`\\b(${amount})\\s+(?:most|least)\\s+polluted\\b`, "i"))?.[1];
  if (!value) return 0;
  return Number(value) || NUMBER_WORDS[value.toLowerCase()] || 0;
}

function relativeYearRange(
  query: string,
  availableYears: number[]
): [number, number] | undefined {
  if (availableYears.length === 0) return undefined;
  const latest = availableYears[availableYears.length - 1];
  const amountPattern =
    "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|\\d{1,2}";
  const years = query.match(
    new RegExp(`\\b(?:last|past|previous|for(?: the)?(?: last)?|over(?: the)?(?: last)?)\\s+(${amountPattern})\\s+years?\\b`, "i")
  );
  const decades = query.match(
    new RegExp(`\\b(?:last|past|previous|for(?: the)?(?: last)?|over(?: the)?(?: last)?)\\s+(?:(?:the|a)\\s+)?(${amountPattern})?\\s*decades?\\b`, "i")
  );
  const bareDecade = /\b(?:last|past|previous|for the last|over the last)\s+(?:a\s+|one\s+)?decade\b/i.test(query);
  const yearSpan = years
    ? Number(years[1]) || NUMBER_WORDS[years[1].toLowerCase()]
    : undefined;
  const decadeCount = decades?.[1]
    ? Number(decades[1]) || NUMBER_WORDS[decades[1].toLowerCase()]
    : bareDecade || decades
      ? 1
      : undefined;
  const span = decadeCount ? decadeCount * 10 : yearSpan;
  if (!span) return undefined;

  const desiredStart = latest - span;
  const start = availableYears.find((year) => year >= desiredStart);
  return start !== undefined ? [start, latest] : undefined;
}

function hasUsableData(row: DataRow): boolean {
  return (
    LEVELS.some((level) => Boolean(row[level])) &&
    [row.pm25, row.llpp, row.llppWho, row.llppNational, row.population].some(
      isNumber
    )
  );
}

function isStringRecord(value: unknown): value is CsvRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).every((item) => typeof item === "string")
  );
}

function normalizeColumn(value: string): string {
  return value
    .toLowerCase()
    .replace(/[µμ]/g, "u")
    .replace(/2\.5/g, "25")
    .replace(/[^a-z0-9]/g, "");
}

function normalizePlace(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((token) => PLACE_TOKEN_ALIASES[token] ?? token)
    .join(" ");
}

function cleanPlace(value?: string): string | undefined {
  const cleaned = value?.trim();
  return cleaned || undefined;
}

function parseNumeric(value?: string): number | undefined {
  if (!value || /^(?:na|n\/a|null|none|-)$/i.test(value.trim())) return undefined;
  const parsed = Number(value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseYear(value?: string): number | undefined {
  const year = parseNumeric(value);
  return year !== undefined && year >= 1900 && year <= 2200
    ? Math.round(year)
    : undefined;
}

function formatNumber(value: number): string {
  return Number(value.toFixed(2)).toString();
}

function formatSigned(value: number): string {
  const formatted = formatNumber(Math.abs(value));
  return value > 0 ? `+${formatted}` : value < 0 ? `-${formatted}` : "0";
}

function formatInteger(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function pluralLevel(level: GeographyLevel): string {
  return level === "country" ? "countries" : `${level}s`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
