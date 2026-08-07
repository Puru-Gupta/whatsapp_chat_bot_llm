export type CsvDatasetLevel = "gadm0" | "gadm1" | "gadm2";

export interface CsvSourceDescriptor {
  id: string;
  title?: string | null;
  file_path?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  dataset_level?: CsvDatasetLevel;
}

export function inferCsvDatasetLevel(input: {
  title?: string | null;
  filePath?: string | null;
  columns?: string[];
}): CsvDatasetLevel | undefined {
  const identity = `${input.filePath ?? ""} ${input.title ?? ""}`.toLowerCase();
  const namedLevel = identity.match(
    /(?:^|[^a-z0-9])gadm[\s_-]*([012])(?:[^0-9]|$)/i
  )?.[1];
  if (namedLevel) return `gadm${namedLevel}` as CsvDatasetLevel;

  const columns = new Set((input.columns ?? []).map(normalizeColumn));
  if (hasAny(columns, ["district", "districtname", "name2", "county"])) {
    return "gadm2";
  }
  if (hasAny(columns, ["state", "statename", "name1", "province"])) {
    return "gadm1";
  }
  if (hasAny(columns, ["country", "countryname", "name0", "nation"])) {
    return "gadm0";
  }
  return undefined;
}

export function selectLatestCsvSources<T extends CsvSourceDescriptor>(
  sources: T[]
): T[] {
  const latestByLevel = new Map<CsvDatasetLevel, T>();
  const unclassified: T[] = [];

  for (const source of sources) {
    const level =
      source.dataset_level ??
      inferCsvDatasetLevel({
        title: source.title,
        filePath: source.file_path,
      });
    if (!level) {
      unclassified.push(source);
      continue;
    }

    const current = latestByLevel.get(level);
    if (!current || sourceTimestamp(source) > sourceTimestamp(current)) {
      latestByLevel.set(level, source);
    }
  }

  return [...latestByLevel.values(), ...unclassified];
}

export function csvLevelLabel(level: CsvDatasetLevel): string {
  return level.toUpperCase();
}

function sourceTimestamp(source: CsvSourceDescriptor): number {
  return Date.parse(source.updated_at ?? source.created_at ?? "") || 0;
}

function normalizeColumn(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function hasAny(values: Set<string>, candidates: string[]): boolean {
  return candidates.some((candidate) => values.has(candidate));
}
