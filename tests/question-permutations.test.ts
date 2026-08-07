import test from "node:test";
import assert from "node:assert/strict";
import { answerCsvQuestionFromRecords } from "../lib/csv-query";

const records: Array<Record<string, string>> = [
  { country: "India", year: "2004", pm25: "55", llpp_who: "4.9", llpp_nat: "1.47", natstandard: "40" },
  { country: "India", year: "2010", pm25: "50", llpp_who: "4.41", llpp_nat: "0.98", natstandard: "40" },
  { country: "India", year: "2014", pm25: "48", llpp_who: "4.21", llpp_nat: "0.78", natstandard: "40" },
  { country: "India", year: "2020", pm25: "44", llpp_who: "3.82", llpp_nat: "0.39", natstandard: "40" },
  { country: "India", year: "2021", pm25: "43", llpp_who: "3.72", llpp_nat: "0.29", natstandard: "40" },
  { country: "India", year: "2024", pm25: "41", llpp_who: "3.53", llpp_nat: "0.1", natstandard: "40" },
  { country: "China", year: "2004", pm25: "62", llpp_who: "5.59", llpp_nat: "2.16", natstandard: "35" },
  { country: "China", year: "2010", pm25: "60", llpp_who: "5.39", llpp_nat: "2.45", natstandard: "35" },
  { country: "China", year: "2014", pm25: "52", llpp_who: "4.61", llpp_nat: "1.67", natstandard: "35" },
  { country: "China", year: "2020", pm25: "35", llpp_who: "2.94", llpp_nat: "0", natstandard: "35" },
  { country: "China", year: "2021", pm25: "33", llpp_who: "2.74", llpp_nat: "0", natstandard: "35" },
  { country: "China", year: "2024", pm25: "30", llpp_who: "2.45", llpp_nat: "0", natstandard: "35" },
  { country: "Nepal", year: "2024", pm25: "37", llpp_who: "3.14", natstandard: "25" },
  { country: "Myanmar", year: "2024", pm25: "29", llpp_who: "2.35", natstandard: "25" },
  { country: "India", name_1: "Uttar Pradesh", year: "2014", pm25: "70", llpp_who: "6.37", natstandard: "40" },
  { country: "India", name_1: "Uttar Pradesh", year: "2021", pm25: "61", llpp_who: "5.49", natstandard: "40" },
  { country: "India", name_1: "Uttar Pradesh", year: "2022", pm25: "58", llpp_who: "5.19", natstandard: "40" },
  { country: "India", name_1: "Uttar Pradesh", year: "2024", pm25: "54", llpp_who: "4.8", natstandard: "40" },
  { country: "India", name_1: "Bihar", year: "2014", pm25: "75", llpp_who: "6.86", natstandard: "40" },
  { country: "India", name_1: "Bihar", year: "2021", pm25: "66", llpp_who: "5.98", natstandard: "40" },
  { country: "India", name_1: "Bihar", year: "2022", pm25: "63", llpp_who: "5.68", natstandard: "40" },
  { country: "India", name_1: "Bihar", year: "2024", pm25: "58", llpp_who: "5.19", natstandard: "40" },
  { country: "India", name_1: "West Bengal", year: "2014", pm25: "60", llpp_who: "5.39", natstandard: "40" },
  { country: "India", name_1: "West Bengal", year: "2021", pm25: "53", llpp_who: "4.7", natstandard: "40" },
  { country: "India", name_1: "West Bengal", year: "2024", pm25: "48", llpp_who: "4.21", natstandard: "40" },
];

test("handles explicit two-place comparison range permutations", () => {
  const questions = [
    "Compare India and China air pollution between 2010-2020",
    "Compare India versus China from 2010 to 2020",
    "What was the difference between India and China from 2010 through 2020?",
    "India vs China PM2.5, 2010-2020",
  ];
  for (const question of questions) {
    const answer = answerCsvQuestionFromRecords(question, records);
    assert.match(answer!, /Comparison from 2010 to 2020/);
    assert.match(answer!, /India: PM2\.5 50 → 44/);
    assert.match(answer!, /China: PM2\.5 60 → 35/);
  }
});

test("handles relative comparison periods written in digits and words", () => {
  const cases = [
    ["Compare India and China for the last decade", /2014 to 2024/],
    ["India versus China over the past ten years", /2014 to 2024/],
    ["Compare India and China for 3 years", /2021 to 2024/],
    ["Compare India and China over the last three years", /2021 to 2024/],
    ["Compare India and China for last 2 decade", /2004 to 2024/],
    ["Compare India and China for last two decades", /2004 to 2024/],
  ] as const;
  for (const [question, range] of cases) {
    const answer = answerCsvQuestionFromRecords(question, records);
    assert.match(answer!, range, question);
    assert.match(answer!, /India: PM2\.5/);
    assert.match(answer!, /China: PM2\.5/);
  }
});

test("recognizes national-standard abbreviation permutations", () => {
  const questions = [
    "List countries with national std more than 30",
    "List countries with nat std above 30",
    "Countries where national limit exceeds 30",
    "List countries with nat-standard > 30",
  ];
  for (const question of questions) {
    const answer = answerCsvQuestionFromRecords(question, records);
    assert.match(answer!, /national PM2\.5 standard above 30 µg\/m³/);
    assert.match(answer!, /India/);
    assert.match(answer!, /China/);
    assert.doesNotMatch(answer!, /Nepal —/);
  }
});

test("handles common Myanmar misspellings and historical name", () => {
  for (const place of ["Mayammar", "Myanmmar", "Myamar", "Burma"]) {
    const answer = answerCsvQuestionFromRecords(`${place} PM2.5`, records);
    assert.match(answer!, /Myanmar, 2024/);
    assert.match(answer!, /29 µg\/m³/);
  }
});

test("asks before expanding an ambiguous top-N-every-year request", () => {
  const query = "Compare the top ten most polluted states in India every year";
  const answer = answerCsvQuestionFromRecords(query, records);
  assert.match(answer!, /Do you want \(1\).*averaged across the period, or \(2\).*for each year/);

  const average = answerCsvQuestionFromRecords(`${query} 1`, records, {
    currentQuery: "1",
    usedConversationContext: true,
  });
  assert.match(average!, /1998|2014–2024 average/);

  const annual = answerCsvQuestionFromRecords(`${query} 2`, records, {
    currentQuery: "2",
    usedConversationContext: true,
  });
  assert.match(annual!, /Most polluted state for each year/);
});

test("supports word-based top counts", () => {
  const answer = answerCsvQuestionFromRecords(
    "Give top three most polluted states in India in 2024",
    records
  );
  assert.match(answer!, /top 3 states/);
  assert.match(answer!, /^3\./m);
  assert.doesNotMatch(answer!, /^4\./m);
});

test("compares country GADM0 data with state GADM1 data and labels the levels", () => {
  const answer = answerCsvQuestionFromRecords(
    "Compare India and Uttar Pradesh air pollution for last decade",
    records
  );
  assert.match(answer!, /Comparison from 2014 to 2024/);
  assert.match(answer!, /India uses GADM0 country-level data/);
  assert.match(answer!, /Uttar Pradesh uses GADM1 state-level data/);
  assert.match(answer!, /India: PM2\.5 48 → 41/);
  assert.match(answer!, /Uttar Pradesh: PM2\.5 70 → 54/);
  assert.match(answer!, /Reference: GADM0 CSV \+ GADM1 CSV/);
});

test("keeps threshold operator and metric permutations equivalent", () => {
  const questions = [
    "Countries with PM2.5 greater than 35 in 2024",
    "List countries whose pollution exceeded 35 during 2024",
    "Show countries with PM 2.5 over 35 for 2024",
    "Which countries had PM2.5 above 35 in 2024?",
  ];
  for (const question of questions) {
    const answer = answerCsvQuestionFromRecords(question, records);
    assert.match(answer!, /PM2\.5 above 35 µg\/m³, 2024/);
    assert.match(answer!, /India/);
    assert.match(answer!, /Nepal/);
    assert.doesNotMatch(answer!, /China —/);
  }
});

test("compares two named states under the national benchmark", () => {
  const answer = answerCsvQuestionFromRecords(
    "Compare Bihar and Uttar Pradesh life year loss as per national standard",
    records
  );
  assert.match(answer!, /Using 2024 and the national PM2\.5 standard/);
  assert.match(answer!, /Bihar:/);
  assert.match(answer!, /Uttar Pradesh:/);
  assert.match(answer!, /Reference: GADM1 CSV/);
});

test("infers a comparison when two places are joined without the word compare", () => {
  const answer = answerCsvQuestionFromRecords(
    "What is life year loss as per national standard for Bihar and Uttar Pradesh for last two years",
    records
  );
  assert.match(answer!, /Comparison from 2022 to 2024/);
  assert.match(answer!, /Bihar:/);
  assert.match(answer!, /Uttar Pradesh:/);
  assert.match(answer!, /national PM2\.5 standard/);
});
