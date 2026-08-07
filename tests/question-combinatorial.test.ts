import test from "node:test";
import assert from "node:assert/strict";
import { answerCsvQuestionFromRecords } from "../lib/csv-query";

const rows: Array<Record<string, string>> = [
  { country: "India", year: "2004", pm25: "55", llpp_who: "4.9", llpp_nat: "1.47", natstandard: "40" },
  { country: "India", year: "2010", pm25: "50", llpp_who: "4.41", llpp_nat: "0.98", natstandard: "40" },
  { country: "India", year: "2014", pm25: "48", llpp_who: "4.21", llpp_nat: "0.78", natstandard: "40" },
  { country: "India", year: "2020", pm25: "44", llpp_who: "3.82", llpp_nat: "0.39", natstandard: "40" },
  { country: "India", year: "2021", pm25: "43", llpp_who: "3.72", llpp_nat: "0.29", natstandard: "40" },
  { country: "India", year: "2024", pm25: "41", llpp_who: "3.53", llpp_nat: "0.1", natstandard: "40" },
  { country: "China", year: "2004", pm25: "62", llpp_who: "5.59", llpp_nat: "2.65", natstandard: "35" },
  { country: "China", year: "2010", pm25: "60", llpp_who: "5.39", llpp_nat: "2.45", natstandard: "35" },
  { country: "China", year: "2014", pm25: "52", llpp_who: "4.61", llpp_nat: "1.67", natstandard: "35" },
  { country: "China", year: "2020", pm25: "35", llpp_who: "2.94", llpp_nat: "0", natstandard: "35" },
  { country: "China", year: "2021", pm25: "33", llpp_who: "2.74", llpp_nat: "0", natstandard: "35" },
  { country: "China", year: "2024", pm25: "30", llpp_who: "2.45", llpp_nat: "0", natstandard: "35" },
  { country: "Nepal", year: "2024", pm25: "37", llpp_who: "3.14", natstandard: "25" },
  { country: "Qatar", year: "2024", pm25: "35", llpp_who: "2.94", natstandard: "35" },
  { country: "India", name_1: "State A", year: "2014", pm25: "70", llpp_who: "6.37" },
  { country: "India", name_1: "State A", year: "2024", pm25: "60", llpp_who: "5.39" },
  { country: "India", name_1: "State B", year: "2014", pm25: "60", llpp_who: "5.39" },
  { country: "India", name_1: "State B", year: "2024", pm25: "50", llpp_who: "4.41" },
  { country: "India", name_1: "State C", year: "2014", pm25: "50", llpp_who: "4.41" },
  { country: "India", name_1: "State C", year: "2024", pm25: "40", llpp_who: "3.43" },
  { country: "India", name_1: "State D", year: "2014", pm25: "40", llpp_who: "3.43" },
  { country: "India", name_1: "State D", year: "2024", pm25: "30", llpp_who: "2.45" },
  { country: "India", name_1: "State E", year: "2014", pm25: "30", llpp_who: "2.45" },
  { country: "India", name_1: "State E", year: "2024", pm25: "20", llpp_who: "1.47" },
];

test("comparison connector and period combinations stay equivalent", () => {
  const connectors = [
    "Compare India and China",
    "India versus China",
    "India vs China",
    "Show the difference between India and China",
  ];
  const periods = [
    ["between 2010 and 2020", /2010 to 2020/],
    ["from 2010 through 2020", /2010 to 2020/],
    ["for the last decade", /2014 to 2024/],
    ["over the past ten years", /2014 to 2024/],
    ["during the previous 3 years", /2021 to 2024/],
    ["for the last two decades", /2004 to 2024/],
  ] as const;

  for (const connector of connectors) {
    for (const [period, expectedRange] of periods) {
      const question = `${connector} PM2.5 ${period}`;
      const answer = answerCsvQuestionFromRecords(question, rows);
      assert.match(answer!, expectedRange, question);
      assert.match(answer!, /India: PM2\.5/, question);
      assert.match(answer!, /China: PM2\.5/, question);
    }
  }
});

test("strict and inclusive threshold phrase combinations preserve semantics", () => {
  const strictAbove = [
    "more than",
    "greater than",
    "above",
    "over",
    "exceeds",
    "exceeded",
    "in excess of",
  ];
  for (const operator of strictAbove) {
    const question = `List countries with PM2.5 ${operator} 35 in 2024`;
    const answer = answerCsvQuestionFromRecords(question, rows);
    assert.match(answer!, /PM2\.5 above 35 µg\/m³/, question);
    assert.match(answer!, /India/, question);
    assert.match(answer!, /Nepal/, question);
    assert.doesNotMatch(answer!, /China —/, question);
  }

  const inclusiveAbove = ["at least", "no less than", "more than or equal to"];
  for (const operator of inclusiveAbove) {
    const question = `List countries with PM2.5 ${operator} 35 in 2024`;
    const answer = answerCsvQuestionFromRecords(question, rows);
    assert.match(answer!, /PM2\.5 at or above 35 µg\/m³/, question);
    assert.match(answer!, /Qatar/, question);
  }
});

test("ranking order and count combinations return the requested number", () => {
  const questions = [
    "Top 5 polluted states in India in 2024",
    "Top five most polluted states in India for 2024",
    "Show 5 most polluted states of India during 2024",
    "Rank the highest five states in India by PM2.5 in 2024",
  ];
  for (const question of questions) {
    const answer = answerCsvQuestionFromRecords(question, rows);
    assert.match(answer!, /top 5 states in India, 2024/, question);
    assert.match(answer!, /^5\./m, question);
    assert.doesNotMatch(answer!, /^6\./m, question);
  }
});

test("national benchmark aliases select national life loss", () => {
  const aliases = [
    "national standard",
    "national std",
    "national limit",
    "nat std",
    "nat-standard",
  ];
  for (const alias of aliases) {
    const question = `India life loss using ${alias} in 2024`;
    const answer = answerCsvQuestionFromRecords(question, rows);
    assert.match(answer!, /0\.1 years of life loss/, question);
    assert.match(answer!, /national PM2\.5 standard/, question);
  }
});
