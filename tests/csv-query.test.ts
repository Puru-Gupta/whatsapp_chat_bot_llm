import test from "node:test";
import assert from "node:assert/strict";
import { answerCsvQuestionFromRecords } from "../lib/csv-query";

const records = [
  { name0: "India", name1: "Delhi", year: "2020", pm25: "60", llpp_who: "5.39", population: "20,000,000" },
  { name0: "India", name1: "Delhi", year: "2024", pm25: "72", llpp_who: "6.57", population: "21,000,000" },
  { name0: "India", name1: "Uttar Pradesh", year: "2024", pm25: "58", llpp_who: "5.19", population: "240,000,000" },
  { name0: "India", name1: "Maharashtra", year: "2024", pm25: "35", population: "125,000,000", national_pm25_standard: "40" },
  { name0: "India", year: "2024", pm25: "42", llpp_who: "3.63", llpp_national: "0.2", population: "1,400,000,000", national_pm25_standard: "40" },
  { name0: "Nepal", year: "2024", pm25: "38", llpp_who: "3.2", population: "30,000,000" },
];

test("ranks states by PM2.5 using the latest year", () => {
  const answer = answerCsvQuestionFromRecords(
    "Top 2 states in India by PM2.5",
    records
  );
  assert.match(answer, /^Here are the top 2 states in India, 2024/);
  assert.match(answer, /1\. Delhi — 72 µg\/m³/);
  assert.match(answer, /2\. Uttar Pradesh — 58 µg\/m³/);
});

test("ranks states by average PM2.5 across an explicit year range", () => {
  const answer = answerCsvQuestionFromRecords(
    "Top 2 most polluted states in India between 2020-2024",
    [
      { country: "India", name_1: "State A", year: "2020", pm25: "30", llpp_who: "2.45" },
      { country: "India", name_1: "State A", year: "2024", pm25: "50", llpp_who: "4.41" },
      { country: "India", name_1: "State B", year: "2020", pm25: "45", llpp_who: "3.92" },
      { country: "India", name_1: "State B", year: "2024", pm25: "45", llpp_who: "3.92" },
    ]
  );
  assert.match(answer!, /^Here are the top 2 states in India, 2020–2024 average/);
  assert.match(answer!, /1\. State B — 45 µg\/m³ PM2\.5/);
  assert.match(answer!, /2\. State A — 40 µg\/m³ PM2\.5/);
});

test("returns the most polluted state for every year in a requested range", () => {
  const answer = answerCsvQuestionFromRecords(
    "Give me the most polluted state in India for each year from 2020 to 2024",
    [
      { country: "India", name_1: "State A", year: "2020", pm25: "50", llpp_who: "4.41" },
      { country: "India", name_1: "State B", year: "2020", pm25: "40", llpp_who: "3.43" },
      { country: "India", name_1: "State A", year: "2024", pm25: "45", llpp_who: "3.92" },
      { country: "India", name_1: "State B", year: "2024", pm25: "60", llpp_who: "5.39" },
    ]
  );
  assert.match(answer!, /^Most polluted state for each year, 2020–2024/);
  assert.match(answer!, /2020: State A — 50 µg\/m³ PM2\.5/);
  assert.match(answer!, /2024: State B — 60 µg\/m³ PM2\.5/);
});

test("handles joined state names in peak PM2.5 questions", () => {
  const answer = answerCsvQuestionFromRecords(
    "Highest pm in last 20 years for uttarpradesh",
    [
      { country: "India", name_1: "Uttar Pradesh", year: "2004", pm25: "40", llpp_who: "3.43" },
      { country: "India", name_1: "Uttar Pradesh", year: "2020", pm25: "60", llpp_who: "5.39" },
      { country: "India", name_1: "Uttar Pradesh", year: "2024", pm25: "55", llpp_who: "4.9" },
    ]
  );
  assert.match(answer!, /^Highest PM2\.5 for Uttar Pradesh, 2004–2024/);
  assert.match(answer!, /2020: 60 µg\/m³/);
});

test("explains the current state-level boundary for district requests", () => {
  const answer = answerCsvQuestionFromRecords(
    "Top 10 polluted districts in India",
    records
  );
  assert.match(answer!, /District-level data is not currently available/);
  assert.match(answer!, /country or state\/province level/);
});

test("compares two places with CSV-provided WHO life loss", () => {
  const answer = answerCsvQuestionFromRecords(
    "Compare Delhi and Uttar Pradesh",
    records
  );
  assert.match(answer, /Using 2024 and the WHO guideline/);
  assert.match(answer, /Delhi: 72 µg\/m³, 6\.57 years life loss/);
  assert.match(answer, /Uttar Pradesh: 58 µg\/m³, 5\.19 years life loss/);
  assert.match(answer, /Delhi has 14 µg\/m³ higher PM2\.5/);
});

test("shows start, end, change, and direction for trends", () => {
  const answer = answerCsvQuestionFromRecords(
    "Delhi trend from 2020 to 2024",
    records
  );
  assert.match(answer, /PM2\.5 changed from 60 to 72 µg\/m³/);
  assert.match(answer, /Change: \+12 µg\/m³/);
  assert.match(answer, /Life loss changed from 5\.39 to 6\.57 years/);
  assert.match(answer, /Direction: worsened/);
  assert.match(answer, /Reference: GADM1 CSV, 2020–2024/);
});

test("calculates life loss for a custom target when no llpp is available", () => {
  const answer = answerCsvQuestionFromRecords(
    "Maharashtra PM2.5 with custom target 10 µg/m³",
    records
  );
  assert.match(answer, /35 µg\/m³ PM2\.5/);
  assert.match(answer, /2\.45 years of life loss/);
});

test("uses llpp_national directly for the national benchmark", () => {
  const answer = answerCsvQuestionFromRecords(
    "India pollution level using national standard",
    records
  );
  assert.match(answer, /42 µg\/m³ PM2\.5/);
  assert.match(answer, /0\.2 years of life loss/);
});

test("returns the exact missing-data response", () => {
  const answer = answerCsvQuestionFromRecords("Bhutan PM2.5 in 2024", records);
  assert.match(answer!, /I could not find that location/);
  assert.match(answer!, /Reference checked:/);
});

test("supports the uploaded wide-year state schema", () => {
  const wideRecords = [
    {
      region: "South Asia",
      country: "India",
      name_1: "Delhi",
      population: "21000000",
      whostandard: "5",
      natstandard: "40",
      pm2023: "68",
      pm2024: "72",
      llpp_who_2023: "6.17",
      llpp_who_2024: "6.57",
      llpp_nat_2024: "3.14",
    },
    {
      region: "South Asia",
      country: "India",
      name_1: "Uttar Pradesh",
      population: "240000000",
      whostandard: "5",
      natstandard: "40",
      pm2023: "55",
      pm2024: "58",
      llpp_who_2024: "5.19",
      llpp_nat_2024: "1.76",
    },
  ];

  const ranking = answerCsvQuestionFromRecords(
    "Top 2 states in India by PM2.5",
    wideRecords
  );
  assert.match(ranking, /Delhi — 72 µg\/m³/);
  assert.match(ranking, /Uttar Pradesh — 58 µg\/m³/);

  const trend = answerCsvQuestionFromRecords(
    "Delhi trend from 2023 to 2024",
    wideRecords
  );
  assert.match(trend, /PM2\.5 changed from 68 to 72 µg\/m³/);
  assert.match(trend, /Life loss changed from 6\.17 to 6\.57 years/);
});

test("supports name_2 district rows and the CSV WHO standard", () => {
  const districtRecords = [
    {
      objectid_gadm2: "1",
      iso_alpha3: "IND",
      continent: "Asia",
      region: "South Asia",
      country: "India",
      name_1: "Uttar Pradesh",
      name_2: "Lucknow",
      population: "5000000",
      whostandard: "10",
      natstandard: "40",
      pm2024: "30",
    },
  ];

  const answer = answerCsvQuestionFromRecords(
    "Lucknow district PM2.5 in 2024 using WHO",
    districtRecords
  );
  assert.match(answer!, /Lucknow, 2024/);
  assert.match(answer!, /30 µg\/m³ PM2\.5/);
  assert.match(answer!, /1\.96 years of life loss/);
  assert.match(answer!, /Reference: GADM2 CSV/);
});

test("routes a natural regional pollution question to CSV data", () => {
  const regionalRecords = [
    { region: "South Asia", country: "India", year: "2024", pm25: "42", llpp_who: "3.63", population: "1400000000" },
    { region: "South Asia", country: "Nepal", year: "2024", pm25: "38", llpp_who: "3.2", population: "30000000" },
    { region: "South East Asia", country: "Sri Lanka", name1: "South", year: "2024", pm25: "10", llpp_who: "0.49", population: "1000000" },
  ];

  const answer = answerCsvQuestionFromRecords(
    "What is the air pollution in South Asia?",
    regionalRecords
  );
  assert.match(answer, /South Asia, 2024/);
  assert.match(answer, /PM2\.5/);
});

test("keeps a PM2.5 definition question out of the CSV answer path", () => {
  assert.equal(answerCsvQuestionFromRecords("What is PM2.5?", records), null);
});

test("uses GADM0 for country values instead of aggregating GADM1 rows", () => {
  const answer = answerCsvQuestionFromRecords(
    "What is India's PM2.5?",
    records
  );
  assert.match(answer!, /India, 2024.*42 µg\/m³ PM2\.5/);
  assert.match(answer!, /Reference: GADM0 CSV/);
});

test("scopes a state ranking to the named country", () => {
  const scopedRecords = [
    ...records,
    { name0: "Nepal", name1: "Bagmati", year: "2024", pm25: "99", llpp_who: "9.21" },
  ];
  const answer = answerCsvQuestionFromRecords(
    "Top 2 states in India by PM2.5",
    scopedRecords
  );
  assert.doesNotMatch(answer!, /Bagmati/);
  assert.match(answer!, /Reference: GADM1 CSV/);
});

test("asks for a level when a ranking has no established level", () => {
  const answer = answerCsvQuestionFromRecords("Which place is worst?", records);
  assert.match(answer!, /country or state\/province level/);
  assert.match(answer!, /Reference checked: current GADM CSV files/);
});

test("reports an unavailable year and the CSV level checked", () => {
  const answer = answerCsvQuestionFromRecords(
    "Delhi PM2.5 in 2035",
    records
  );
  assert.match(answer!, /I don’t have data for that year in the current CSV/);
  assert.match(answer!, /Reference checked: GADM1 CSV/);
});

test("uses GADM2 and includes the state in district rankings", () => {
  const districtRecords = [
    { name0: "India", name1: "Uttar Pradesh", name2: "Lucknow", year: "2024", pm25: "70", llpp_who: "6.37" },
    { name0: "India", name1: "Uttar Pradesh", name2: "Kanpur", year: "2024", pm25: "75", llpp_who: "6.86" },
  ];
  const answer = answerCsvQuestionFromRecords(
    "Top districts in Uttar Pradesh by life loss",
    districtRecords
  );
  assert.match(answer!, /Kanpur, Uttar Pradesh — 6\.86 years/);
  assert.match(answer!, /Reference: GADM2 CSV/);
});

test("marks answers that use previous conversation context", () => {
  const answer = answerCsvQuestionFromRecords(
    "Uttar Pradesh What about WHO?",
    records,
    { currentQuery: "What about WHO?", usedConversationContext: true }
  );
  assert.match(answer!, /Reference: Previous conversation context \+ GADM1 CSV/);
});

test("answers a bare country name from GADM0", () => {
  const pakistanRecords = [
    { country: "Pakistan", year: "2024", pm25: "45", llpp_who: "3.92" },
  ];
  const answer = answerCsvQuestionFromRecords("Pakistan", pakistanRecords);
  assert.match(answer!, /Pakistan, 2024/);
  assert.match(answer!, /Reference: GADM0 CSV/);
});

test("uses saved context to list life loss for each state", () => {
  const pakistanRecords = [
    { country: "Pakistan", name_1: "Punjab", year: "2024", pm25: "46", llpp_who: "4.02" },
    { country: "Pakistan", name_1: "Sindh", year: "2024", pm25: "42", llpp_who: "3.63" },
  ];
  const answer = answerCsvQuestionFromRecords(
    "I want Pakistan's most polluted state What is life year loss of each states",
    pakistanRecords,
    {
      currentQuery: "What is life year loss of each states",
      usedConversationContext: true,
    }
  );
  assert.match(answer!, /^Here are all available states in Pakistan, 2024/);
  assert.match(answer!, /Punjab — 4\.02 years/);
  assert.match(answer!, /Sindh — 3\.63 years/);
  assert.match(answer!, /Previous conversation context \+ GADM1 CSV/);
});

test("reports which GADM CSV levels are active", () => {
  const answer = answerCsvQuestionFromRecords(
    "Do you have access to GADM2?",
    records
  );
  assert.match(answer!, /GADM2 is not currently uploaded and active/);
  assert.match(answer!, /Available now: GADM0, GADM1/);
});

test("does not ask for a proportional ranking metric and shows both values", () => {
  const answer = answerCsvQuestionFromRecords(
    "Which state in India is worst?",
    records
  );
  assert.match(answer!, /Delhi — 72 µg\/m³ PM2\.5; 6\.57 years life loss/);
  assert.match(answer!, /Reference: GADM1 CSV/);
});

test("asks for a place instead of guessing", () => {
  const answer = answerCsvQuestionFromRecords("What is the life loss?", records);
  assert.match(answer!, /Which place should I check/);
});

test("asks for country scope before listing every state", () => {
  const answer = answerCsvQuestionFromRecords(
    "List all states by life loss",
    records
  );
  assert.match(answer!, /Which country should I use for the state ranking/);
});

test("asks only for country when top states have no country", () => {
  const answer = answerCsvQuestionFromRecords("Give top 5 states", records);
  assert.match(answer!, /Which country should I use for the top 5 states/);
  assert.doesNotMatch(answer!, /PM2\.5 or life expectancy loss/);
});

test("routes most-polluted state wording to the country clarification", () => {
  const answer = answerCsvQuestionFromRecords("Most polluted states?", records);
  assert.match(answer!, /Which country should I use for the state ranking/);
});

test("sorts most-populated rankings by population and shows all values", () => {
  const answer = answerCsvQuestionFromRecords(
    "Give top 2 most populated states and pollution and life loss in India",
    records
  );
  assert.match(answer!, /^Here are the 2 most populated states in India/);
  assert.match(
    answer!,
    /Uttar Pradesh — 240,000,000 people; 58 µg\/m³ PM2\.5; 5\.19 years life loss/
  );
  assert.match(
    answer!,
    /Maharashtra — 125,000,000 people; 35 µg\/m³ PM2\.5/
  );
});

test("answers a singular worldwide state ranking without asking for country", () => {
  const worldwideRecords = [
    ...records,
    { name0: "Bangladesh", name1: "Dhaka", year: "2024", pm25: "90", llpp_who: "8.33" },
  ];
  const answer = answerCsvQuestionFromRecords(
    "What is the top state in the whole world?",
    worldwideRecords
  );
  assert.match(answer!, /^Here is the top state, 2024/);
  assert.match(answer!, /1\. Dhaka, Bangladesh — 90 µg\/m³ PM2\.5/);
  assert.doesNotMatch(answer!, /^2\./m);
});

test("keeps state level when a clarification says among all countries", () => {
  const worldwideRecords = [
    ...records,
    { name0: "Bangladesh", name1: "Dhaka", year: "2024", pm25: "90", llpp_who: "8.33" },
  ];
  const answer = answerCsvQuestionFromRecords(
    "Can you tell me most polluted state in the world Among all the countries",
    worldwideRecords,
    {
      currentQuery: "Among all the countries",
      usedConversationContext: true,
    }
  );
  assert.match(answer!, /Dhaka, Bangladesh/);
  assert.match(answer!, /Previous conversation context \+ GADM1 CSV/);
});

test("asks only for the missing comparison place", () => {
  const answer = answerCsvQuestionFromRecords(
    "Compare NCT of Delhi with another state",
    [
      { name0: "India", name1: "NCT of Delhi", year: "2024", pm25: "80", llpp_who: "7.35" },
      { name0: "Pakistan", name1: "Islamabad", year: "2024", pm25: "58", llpp_who: "5.19" },
    ]
  );
  assert.match(answer!, /Which state would you like to compare with NCT of Delhi/);
});

test("treats one-place two-year comparisons as trends", () => {
  const answer = answerCsvQuestionFromRecords(
    "Compare Dhaka PM2.5 from 2010 with 2024",
    [
      { country: "Bangladesh", name_1: "Dhaka", year: "2010", pm25: "70", llpp_who: "6.37" },
      { country: "Bangladesh", name_1: "Dhaka", year: "2024", pm25: "72", llpp_who: "6.57" },
    ]
  );
  assert.match(answer!, /From 2010 to 2024 for Dhaka/);
  assert.match(answer!, /Change: \+2 µg\/m³/);
});

test("finds a named place's largest annual increase within the last decade", () => {
  const answer = answerCsvQuestionFromRecords(
    "Highest rise in PM2.5 in NCT of Delhi in the last decade",
    [
      { country: "India", name_1: "NCT of Delhi", year: "2014", pm25: "40", llpp_who: "3.43" },
      { country: "India", name_1: "NCT of Delhi", year: "2015", pm25: "60", llpp_who: "5.39" },
      { country: "India", name_1: "NCT of Delhi", year: "2024", pm25: "70", llpp_who: "6.37" },
    ]
  );
  assert.match(answer!, /Largest annual PM2\.5 increase for NCT of Delhi, 2014–2024/);
  assert.match(answer!, /2014 to 2015: 40 → 60 µg\/m³/);
});

test("ranks worldwide state increases over a relative year window", () => {
  const answer = answerCsvQuestionFromRecords(
    "Last five years which state showed the highest increase in PM2.5 world wide",
    [
      { country: "India", name_1: "State A", year: "2019", pm25: "10", llpp_who: "0.49" },
      { country: "India", name_1: "State A", year: "2024", pm25: "30", llpp_who: "2.45" },
      { country: "Bangladesh", name_1: "State B", year: "2019", pm25: "40", llpp_who: "3.43" },
      { country: "Bangladesh", name_1: "State B", year: "2024", pm25: "50", llpp_who: "4.41" },
    ]
  );
  assert.match(answer!, /Largest increases among states, 2019–2024/);
  assert.match(answer!, /1\. State A, India — \+20 µg\/m³/);
  assert.doesNotMatch(answer!, /^2\./m);
});

test("lists countries whose national standard is above a threshold", () => {
  const answer = answerCsvQuestionFromRecords(
    "Give list of countries that have Nat_std more than 25",
    [
      { country: "India", year: "2024", pm25: "42", natstandard: "40" },
      { country: "Bangladesh", year: "2024", pm25: "60", natstandard: "35" },
      { country: "Pakistan", year: "2024", pm25: "45", natstandard: "15" },
    ]
  );
  assert.match(answer!, /Countries with national PM2\.5 standard above 25 µg\/m³/);
  assert.match(answer!, /India — 40 µg\/m³/);
  assert.match(answer!, /Bangladesh — 35 µg\/m³/);
  assert.doesNotMatch(answer!, /Pakistan/);
  assert.match(answer!, /national standard field/);
});

test("calculates total population life-years and supports both benchmarks", () => {
  const answer = answerCsvQuestionFromRecords(
    "Total life year loss in Bangladesh as per WHO and national standards in 2024",
    [
      {
        country: "Bangladesh",
        year: "2024",
        pm25: "60",
        llpp_who: "5.4",
        llpp_national: "2.5",
        population: "100",
      },
    ]
  );
  assert.match(answer!, /WHO guideline: 5\.4 years per person; 540 total person-years lost/);
  assert.match(answer!, /National standard: 2\.5 years per person; 250 total person-years lost/);
  assert.match(answer!, /WHO guideline and national standard benchmarks/);
});

test("answers both per-person benchmark values when both are requested", () => {
  const answer = answerCsvQuestionFromRecords(
    "Give life year loss in Pakistan as per WHO or national standards",
    [
      {
        country: "Pakistan",
        year: "2024",
        pm25: "45",
        llpp_who: "3.92",
        llpp_national: "1.47",
        population: "250000000",
      },
    ]
  );
  assert.match(answer!, /WHO guideline: 3\.92 years life loss per person/);
  assert.match(answer!, /National standard: 1\.47 years life loss per person/);
});

test("uses the requested relative period for a place trend", () => {
  const answer = answerCsvQuestionFromRecords(
    "What is the change in PM2.5 in Dhaka last decade",
    [
      { country: "Bangladesh", name_1: "Dhaka", year: "2014", pm25: "50", llpp_who: "4.41" },
      { country: "Bangladesh", name_1: "Dhaka", year: "2024", pm25: "60", llpp_who: "5.39" },
    ]
  );
  assert.match(answer!, /From 2014 to 2024 for Dhaka/);
  assert.match(answer!, /Change: \+10 µg\/m³/);
});

test("prefers Dhaka over the descriptive word capital", () => {
  const answer = answerCsvQuestionFromRecords(
    "Total life year loss in Banglash capital Dhaka",
    [
      { country: "Bangladesh", name_1: "Dhaka", year: "2024", pm25: "60", llpp_who: "5", population: "100" },
      { country: "Other", name_1: "Capital", year: "2024", pm25: "20", llpp_who: "1", population: "100" },
    ]
  );
  assert.match(answer!, /^Dhaka, 2024:/);
  assert.match(answer!, /500 total person-years lost/);
  assert.doesNotMatch(answer!, /^Capital/);
});

test("ranks countries by life-loss improvement over the last decade", () => {
  const answer = answerCsvQuestionFromRecords(
    "Give list of countries that have shown improvement in life year loss from last decade",
    [
      { country: "A", year: "2014", pm25: "50", llpp_who: "4" },
      { country: "A", year: "2024", pm25: "30", llpp_who: "2" },
      { country: "B", year: "2014", pm25: "40", llpp_who: "3" },
      { country: "B", year: "2024", pm25: "35", llpp_who: "2.5" },
      { country: "C", year: "2014", pm25: "20", llpp_who: "1" },
      { country: "C", year: "2024", pm25: "30", llpp_who: "2" },
    ]
  );
  assert.match(answer!, /Largest improvements among countries, 2014–2024/);
  assert.match(answer!, /1\. A — 2 years improvement/);
  assert.match(answer!, /2\. B — 0\.5 years improvement/);
  assert.doesNotMatch(answer!, /C —/);
});

test("acknowledges the total-life-years calculation definition", () => {
  const answer = answerCsvQuestionFromRecords(
    "Total life year loss means multiply life loss that year with population of country",
    records
  );
  assert.match(answer!, /life loss per person multiplied by.*population/i);
  assert.match(answer!, /Reference: User-provided calculation definition/);
});

test("excludes zero and uninhabited rows from best countries to live", () => {
  const answer = answerCsvQuestionFromRecords(
    "Best countries to live in considering least polluted countries",
    [
      { country: "Empty Islands", year: "2024", pm25: "0", llpp_who: "0", population: "0" },
      { country: "Guam", year: "2024", pm25: "1", llpp_who: "0", population: "170000" },
      { country: "Cleanland", year: "2024", pm25: "3", llpp_who: "0", population: "1000" },
      { country: "Otherland", year: "2024", pm25: "7", llpp_who: "0.2", population: "2000" },
    ]
  );
  assert.match(answer!, /1\. Cleanland/);
  assert.doesNotMatch(answer!, /Empty Islands/);
  assert.doesNotMatch(answer!, /Guam/);
  assert.match(answer!, /PM2\.5 only, not overall quality of life/);
});

test("uses the current total-life metric when previous context mentions population", () => {
  const answer = answerCsvQuestionFromRecords(
    "Total life year loss in Dhaka Previous answer: Dhaka, 2024 population 100 Total life year loss as per WHO guideline and national standard in 2024",
    [
      {
        country: "Bangladesh",
        name_1: "Dhaka",
        year: "2024",
        pm25: "60",
        llpp_who: "5",
        llpp_national: "2",
        population: "100",
      },
    ],
    {
      currentQuery:
        "Total life year loss as per WHO guideline and national standard in 2024",
      usedConversationContext: true,
    }
  );
  assert.match(answer!, /WHO guideline: 5 years per person; 500 total person-years lost/);
  assert.match(answer!, /National standard: 2 years per person; 200 total person-years lost/);
  assert.doesNotMatch(answer!, /^Dhaka, 2024: population/);
});

const numericFilterRecords = [
  { country: "A", year: "2024", pm25: "10", natstandard: "20", whostandard: "5", llpp_who: "0.5", llpp_national: "0.1", population: "50000000" },
  { country: "B", year: "2024", pm25: "20", natstandard: "30", whostandard: "5", llpp_who: "1.5", llpp_national: "0.8", population: "150000000" },
  { country: "C", year: "2024", pm25: "30", natstandard: "40", whostandard: "10", llpp_who: "2.5", llpp_national: "1.2", population: "250000000" },
];

test("supports strict, inclusive, and equality filters for PM2.5", () => {
  const below = answerCsvQuestionFromRecords(
    "List countries with PM2.5 less then 20",
    numericFilterRecords
  );
  assert.match(below!, /1\. A — 10 µg\/m³/);
  assert.doesNotMatch(below!, /B —/);
  assert.doesNotMatch(below!, /WHO guideline benchmark/);

  const inclusive = answerCsvQuestionFromRecords(
    "List countries with PM2.5 <= 20",
    numericFilterRecords
  );
  assert.match(inclusive!, /PM2\.5 at or below 20 µg\/m³/);
  assert.match(inclusive!, /1\. A/);
  assert.match(inclusive!, /2\. B/);

  const equal = answerCsvQuestionFromRecords(
    "List countries with PM2.5 equal to 20",
    numericFilterRecords
  );
  assert.match(equal!, /PM2\.5 equal to 20 µg\/m³/);
  assert.match(equal!, /1\. B/);
  assert.doesNotMatch(equal!, /A —|C —/);
});

test("supports national and WHO standard comparison operators", () => {
  const national = answerCsvQuestionFromRecords(
    "List countries with national standard more than or equal to 30",
    numericFilterRecords
  );
  assert.match(national!, /national PM2\.5 standard at or above 30 µg\/m³/);
  assert.match(national!, /B — 30 µg\/m³/);
  assert.match(national!, /C — 40 µg\/m³/);

  const who = answerCsvQuestionFromRecords(
    "List countries with WHO guideline = 5",
    numericFilterRecords
  );
  assert.match(who!, /WHO PM2\.5 guideline equal to 5 µg\/m³/);
  assert.match(who!, /A — 5 µg\/m³/);
  assert.match(who!, /B — 5 µg\/m³/);
  assert.doesNotMatch(who!, /C —/);

  const naturalEquality = answerCsvQuestionFromRecords(
    "List countries where who standard is 10",
    numericFilterRecords
  );
  assert.match(naturalEquality!, /WHO PM2\.5 guideline equal to 10 µg\/m³/);
  assert.match(naturalEquality!, /1\. C — 10 µg\/m³/);
});

test("supports life-loss and scaled population filters", () => {
  const lifeLoss = answerCsvQuestionFromRecords(
    "List countries with life loss as per national standard at most 0.8",
    numericFilterRecords
  );
  assert.match(lifeLoss!, /national-standard life loss at or below 0\.8 years/);
  assert.match(lifeLoss!, /A — 0\.1 years/);
  assert.match(lifeLoss!, /B — 0\.8 years/);
  assert.doesNotMatch(lifeLoss!, /C —/);

  const population = answerCsvQuestionFromRecords(
    "How many countries have population greater than 100 million",
    numericFilterRecords
  );
  assert.match(population!, /^2 countries have population above 100,000,000 people/);
  assert.doesNotMatch(population!, /WHO guideline benchmark/);
});

test("uses the current numeric condition instead of a stale previous filter", () => {
  const answer = answerCsvQuestionFromRecords(
    "List countries with national standard less than 20 List countries with national standard more than 30",
    numericFilterRecords,
    {
      currentQuery: "List countries with national standard more than 30",
      usedConversationContext: true,
    }
  );
  assert.match(answer!, /national PM2\.5 standard above 30 µg\/m³/);
  assert.match(answer!, /C — 40 µg\/m³/);
  assert.doesNotMatch(answer!, /below 20/);
});

test("applies numeric state filters inside the named country", () => {
  const answer = answerCsvQuestionFromRecords(
    "List states in India with PM2.5 at least 50",
    [
      { country: "India", name_1: "Delhi", year: "2024", pm25: "70" },
      { country: "India", name_1: "Kerala", year: "2024", pm25: "20" },
      { country: "Bangladesh", name_1: "Dhaka", year: "2024", pm25: "80" },
    ]
  );
  assert.match(answer!, /States in India with PM2\.5 at or above 50 µg\/m³/);
  assert.match(answer!, /Delhi — 70 µg\/m³/);
  assert.doesNotMatch(answer!, /Dhaka|Kerala/);
});

test("does not treat an identity question as a WHO data query", () => {
  assert.equal(answerCsvQuestionFromRecords("Who are you?", numericFilterRecords), null);
});

test("excludes known territory rows from country numeric filters", () => {
  const answer = answerCsvQuestionFromRecords(
    "List countries with PM2.5 less than 5",
    [
      { country: "Guam", year: "2024", pm25: "1", population: "100" },
      { country: "Palau", year: "2024", pm25: "2", population: "100" },
    ]
  );
  assert.match(answer!, /Palau — 2 µg\/m³/);
  assert.doesNotMatch(answer!, /Guam/);
  assert.match(answer!, /Known non-country territory entries are excluded/);
});

test("recognizes natural threshold synonym families", () => {
  const cases = [
    ["PM2.5 exceeds 20", /PM2\.5 above 20 µg\/m³/, /1\. C/],
    ["PM2.5 in excess of 20", /PM2\.5 above 20 µg\/m³/, /1\. C/],
    ["PM2.5 no more than 20", /PM2\.5 at or below 20 µg\/m³/, /2\. B/],
    ["PM2.5 maximum of 20", /PM2\.5 at or below 20 µg\/m³/, /2\. B/],
    ["PM2.5 no less than 20", /PM2\.5 at or above 20 µg\/m³/, /1\. C/],
    ["PM2.5 minimum of 20", /PM2\.5 at or above 20 µg\/m³/, /1\. C/],
    ["PM2.5 same as 20", /PM2\.5 equal to 20 µg\/m³/, /1\. B/],
    ["PM2.5 equivalent to 20", /PM2\.5 equal to 20 µg\/m³/, /1\. B/],
    ["PM2.5 fewer than 20", /PM2\.5 below 20 µg\/m³/, /1\. A/],
    ["PM2.5 20 or higher", /PM2\.5 at or above 20 µg\/m³/, /1\. C/],
    ["PM2.5 20 or lower", /PM2\.5 at or below 20 µg\/m³/, /2\. B/],
  ] as const;

  for (const [condition, heading, result] of cases) {
    const answer = answerCsvQuestionFromRecords(
      `List countries with ${condition}`,
      numericFilterRecords
    );
    assert.match(answer!, heading, condition);
    assert.match(answer!, result, condition);
  }
});
