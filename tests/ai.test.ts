import test from "node:test";
import assert from "node:assert/strict";
import {
  buildExtractiveAnswer,
  BOT_CAPABILITY_REPLY,
  formatWhatsAppReply,
  generateAIResponse,
  GREETING_REPLY,
  IDENTITY_REPLY,
  NO_ANSWER_REPLY,
  THANKS_REPLY,
} from "../lib/ai";

test("returns one exact not-found response without context", async () => {
  const answer = await generateAIResponse("What is the refund policy?", "", []);
  assert.equal(answer.text, NO_ANSWER_REPLY);
  assert.equal(answer.source, "not_found");
});

test("responds to a greeting without requiring knowledge context", async () => {
  const answer = await generateAIResponse("Hi", "", []);
  assert.equal(answer.source, "greeting");
  assert.equal(answer.text, GREETING_REPLY);
});

test("responds to thanks separately, including a common misspelling", async () => {
  for (const message of ["Thanks", "Thank you!", "thansk"]) {
    const answer = await generateAIResponse(message, "", []);
    assert.equal(answer.source, "gratitude");
    assert.equal(answer.text, THANKS_REPLY);
  }
});

test("answers identity questions without knowledge context", async () => {
  const answer = await generateAIResponse("Who are you?", "", []);
  assert.equal(answer.source, "identity");
  assert.equal(answer.text, IDENTITY_REPLY);
});

test("answers chatbot value questions without searching the annual report", async () => {
  for (const message of [
    "Why chatbot is important?",
    "What is the benefit of this bot?",
    "How is this chatbot useful?",
  ]) {
    const answer = await generateAIResponse(message, "", []);
    assert.equal(answer.source, "identity");
    assert.equal(answer.text, BOT_CAPABILITY_REPLY);
  }
});

test("uses the model to interpret wording the extractor cannot resolve", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-key";
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "Air pollution can reduce life expectancy.",
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  try {
    const answer = await generateAIResponse(
      "How does dirty air affect people there?",
      `Context 1 [Source: AQLI Report]:\nAir pollution can reduce life expectancy.`,
      []
    );
    assert.equal(answer.source, "model");
    assert.equal(answer.text, "Air pollution can reduce life expectancy.");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = originalApiKey;
    }
  }
});

test("rejects a natural rewrite that drops verified report numbers", async () => {
  const originalFetch = globalThis.fetch;
  const originalApiKey = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-key";
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: "The report says pollution remains a serious global problem.",
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );

  try {
    const context = `Context 1 [Source: AQLI Annual Report 2026]:
At a Glance. Particulate pollution remains the world's greatest external threat to human health. If global PM2.5 levels met the WHO guideline of 5 µg/m³, the average person could live 2.1 years longer. 2024 marks the fifth consecutive year with no meaningful decline in global particulate concentrations. South Asia remained the most polluted region across the world, with an average resident here likely to live 3.7 years longer if particulate concentrations across the region were reduced to meet the WHO guideline.`;
    const answer = await generateAIResponse(
      "Annual report summary?",
      context,
      []
    );

    assert.equal(answer.source, "extractive");
    assert.match(answer.text, /2\.1 years/);
    assert.match(answer.text, /2024/);
    assert.match(answer.text, /3\.7 years/);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = originalApiKey;
    }
  }
});

test("summarizes the annual report from its At a Glance evidence", () => {
  const context = `Context 1 [Source: AQLI Annual Report 2026]:
AQLI Annual Report 2026 Table of Contents Section 1 Section 2 Section 3 At a Glance Particulate pollution remains the world's greatest external threat to human health. If global PM2.5 levels met the WHO guideline of 5 µg/m³, the average person could live 2.1 years longer. Yet progress is stalling. 2024 marks the fifth consecutive year with no meaningful decline in global particulate concentrations. South Asia remained the most polluted region across the world, with an average resident here likely to live 3.7 years longer if particulate concentrations across the region were reduced to meet the WHO guideline.`;

  const answer = buildExtractiveAnswer(context, "Main highlight of repot?");
  assert.match(answer, /greatest external threat/);
  assert.match(answer, /2\.1 years longer/);
  assert.match(answer, /fifth consecutive year/);
  assert.match(answer, /South Asia remained the most polluted/);
  assert.doesNotMatch(answer, /Table of Contents|Section 1/);
});

test("does not present an India trend or standard as its pollution level", () => {
  const context = `Context 1 [Source: AQLI Annual Report 2026]:
Change in particulate levels between 1998 and 2024. India 3.5 46 1.3 > 6; New Delhi 0.3; Ladakh 40 µg/m³ 0.1`;

  assert.equal(
    buildExtractiveAnswer(context, "What is pollution level in India?"),
    NO_ANSWER_REPLY
  );
});

test("answers what AQLI is from website evidence", () => {
  const context = `Context 1 [Source: AQLI Website | https://aqli.epic.uchicago.edu/]:
The Air Quality Life Index (AQLI) converts air pollution concentrations into their impact on life expectancy.`;

  assert.equal(
    buildExtractiveAnswer(context, "What is AQLI?"),
    "The Air Quality Life Index (AQLI) converts air pollution concentrations into their impact on life expectancy."
  );
});

test("scopes a most-polluted-country answer to the report table", () => {
  const context = `Context 1 [Source: AQLI Annual Report 2026]:
Table 3.1: Impacts of particulate pollution on life expectancy in select South Asian countries. Gains from meeting WHO guideline based on 2024 concentrations (years). Bangladesh 5.4 54 2.1. Pakistan 3.9 51 1.5. India 3.5 46 1.3. Nepal 3.2 55 1.3. Afghanistan 2.5 99 1.5.`;

  const answer = buildExtractiveAnswer(context, "Most polluted countries");
  assert.match(answer, /Among the South Asian countries listed/);
  assert.match(answer, /Bangladesh.*5\.4 years/);
  assert.match(answer, /Pakistan \(3\.9 years\)/);
});

test("extracts the direct South Asia PM2.5 finding", () => {
  const context = `Context 1 [Source: AQLI Annual Report]:
In 2023, PM 2.5 concentrations in South Asia were 2.9 percent higher than in 2022, following the 9.6 percent decline between 2021 and 2022.

Context 2 [Source: AQLI Annual Report]:
In India, the particulate concentration in 2023 was 41 ug/m3, more than eight times the WHO guideline.`;

  const answer = buildExtractiveAnswer(
    context,
    "What does the report say about South Asia PM2.5?"
  );

  assert.match(answer, /2\.9 percent higher/);
  assert.equal((answer.match(/2\.9 percent higher/g) ?? []).length, 1);
});

test("does not substitute a 2023 measurement for a 2024 question", () => {
  const context = `Context 1 [Source: AQLI Annual Report]:
In India, the PM 2.5 concentration in 2023 was 41 ug/m3.

Context 2 [Source: AQLI Annual Report]:
India's clean air programme set a pollution-reduction target for 2024.`;

  assert.equal(
    buildExtractiveAnswer(context, "What is PM2.5 in India in 2024?"),
    NO_ANSWER_REPLY
  );
});

test("explains the core AQLI methodology and conversion simply", () => {
  const context = `Context 1 [Source: AQLI Website | https://aqli.example/methodology]:
The AQLI team then combines this information with global satellite data from Washington University in St. Louis.
The AQLI team then combines the satellite estimates of PM2.5 concentrations with associated population data.`;

  const answer = buildExtractiveAnswer(context, "What is AQLI methodology?");
  assert.match(answer, /10 µg\/m³ increase/);
  assert.match(answer, /0\.98 years/);
});

test("answers two-word Canada wildfire phrasing without PDF chart debris", () => {
  const context = `Context 1 [Source: AQLI Annual Report]:
YesNo AQLI 2025 Annual Update | 11 Section 3 Wildfires in Canada significantly worsened air quality in 2023, withPM 2.5 levels rising by over 50 percent in Canada and 20 percent in the United States compared to 2022.
At 9.2 μg/m³, more than 1.5 times the 2022 levels, life expectancy could increase by 5 months if pollution met the WHO guideline.`;

  const answer = buildExtractiveAnswer(context, "Give summary of Canada wild fire");
  assert.match(answer, /over 50 percent in Canada/);
  assert.doesNotMatch(answer, /YesNo|Annual Update/);
  assert.match(answer, /with PM 2\.5/);
});

test("answers misspelled and shuffled Canada wildfire questions from current evidence", () => {
  const context = `Context 1 [Source: AQLI 2025 Annual Update]:
Canada's 2023 wildfires burned roughly 1.3 percent of Canada's total land area. Forest land made up nearly 20 percent of the burned area, contributing to record-high national pollution.`;

  const answer = buildExtractiveAnswer(
    context,
    "summry fire cnada wild explan"
  );

  assert.match(answer, /1\.3 percent/);
  assert.match(answer, /nearly 20 percent/);
  assert.doesNotMatch(answer, /couldn't find/);
});

test("uses the resolved subject for a sequenced US comparison", () => {
  const context = `Context 1 [Source: AQLI 2025 Annual Update]:
Canada's 2023 wildfires burned roughly 1.3 percent of Canada's total land area. The 2020-21 United States wildfires burned roughly 0.5 percent of its total land area.`;

  const answer = buildExtractiveAnswer(
    context,
    "Canada wild fire How much did it change? and compared with the US?"
  );

  assert.match(answer, /1\.3 percent/);
  assert.match(answer, /0\.5 percent/);
});

test("summarizes South Asia from regional evidence", () => {
  const context = `Context 1 [Source: AQLI Website]:
Its pollution is 52 percent higher than China’s pollution, the second most polluted region. Pollution in South Asia cuts life expectancy short by 3.6 years on average and more than 8 years in the most polluted areas.`;

  const answer = buildExtractiveAnswer(
    context,
    "What is the air pollution in South Asia?"
  );
  assert.match(answer, /52 percent higher/);
  assert.match(answer, /3\.6 years/);
});

test("removes repeated response lines", () => {
  const line = "South Asia pollution increased by 2.9 percent.";
  assert.equal(formatWhatsAppReply(`${line}\n${line}`), line);
});
