export const DATA_COVERAGE_NOTICE =
  "Data coverage: Country and state/province level only. District-level data is not currently available.";

export function addDataCoverageNotice(reply: string): string {
  if (
    /Data coverage:/i.test(reply) ||
    /District-level data is not currently available/i.test(reply)
  ) {
    return reply;
  }

  const referenceIndex = reply.search(/\n\nReference(?: checked)?:/i);
  if (referenceIndex < 0) {
    return `${reply}\n\n${DATA_COVERAGE_NOTICE}`;
  }

  return `${reply.slice(0, referenceIndex)}\n\n${DATA_COVERAGE_NOTICE}${reply.slice(referenceIndex)}`;
}
