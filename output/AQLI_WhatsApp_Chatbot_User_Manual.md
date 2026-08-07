# AQLI WhatsApp Chatbot

*Professional User and Administrator Manual*

Country and state/province AQLI analysis in WhatsApp

PM2.5 values | Life-expectancy impact | Rankings | Trends | Comparisons

Version: 1.0

Issued: 4 July 2026

WhatsApp: +91 96547 01203

Admin portal: https://aqli-whatsapp-chatbot.vercel.app

Prepared for AQLI chatbot users, analysts, and administrators

## Document guide

This manual explains how to use the AQLI WhatsApp chatbot, how to interpret its answers, and how administrators maintain conversations and knowledge sources. It reflects the production behavior verified on 4 July 2026.

> **Current data boundary:** The structured database contains country-level (GADM0) and state/province-level (GADM1) data through 2024. District-level (GADM2) data is not currently active.

### Contents

1. About the chatbot
2. Quick start for WhatsApp users
3. How to write a good question
4. Supported question types
5. Conversation memory and reset
6. Understanding answers and references
7. Data coverage, methodology, and limitations
8. Troubleshooting for users
9. Administrator guide
10. Knowledge-base management
11. Operational troubleshooting
12. Testing checklist and prompt library
13. Glossary

## About the chatbot

The AQLI WhatsApp chatbot is a conversational interface for the Air Quality Life Index. It lets a user ask ordinary-language questions about long-term PM2.5 pollution and estimated life-expectancy impact without opening a spreadsheet, report, or analytical dashboard.

### What AQLI means

AQLI means Air Quality Life Index. It translates long-term exposure to fine particulate matter (PM2.5) into an estimated effect on life expectancy. The core relationship used by the chatbot is approximately 0.98 years of life-expectancy loss for each 10 µg/m³ increase in long-term PM2.5 above the selected benchmark.

```text
Life loss per person = max(PM2.5 - benchmark, 0) x 0.098
```

When the uploaded CSV already contains pre-calculated life-loss values, the chatbot uses those fields directly instead of recalculating them.

### Primary audiences

- Policy and program teams that need quick, referenced AQLI facts.
- Researchers and analysts checking values, trends, rankings, and comparisons.
- Communications teams, journalists, educators, and public users seeking short explanations.
- Administrators who upload data and reports, monitor conversations, or take over a chat.

## Quick start for WhatsApp users

### Start a conversation

1. Open WhatsApp and start a chat with +91 96547 01203.
2. Send a greeting such as Hi, Hello, or Good morning.
3. Ask one focused question using a place, metric, and optional year or period.
4. Read the answer, data-coverage notice, and reference line.
5. Ask a follow-up or send reset to begin a new topic.

> **Fastest first test:** Send: What is India's PM2.5 in 2024? Then ask: Compare it with China.

### Quick-reference examples

| Need | Example question |
| --- | --- |
| Latest value | What is India's latest PM2.5? |
| State ranking | Give top 5 most polluted states in India. |
| Threshold list | List countries with PM2.5 above 30 in 2024. |
| Comparison | Compare India and China from 2010 to 2020. |
| Mixed level | Compare India and Uttar Pradesh for the last decade. |
| Trend | Show the PM2.5 trend for Bihar. |
| Benchmark | What is Jharkhand's life loss under the national standard? |
| Methodology | How does AQLI calculate life-expectancy loss? |

## How to write a good question

The chatbot handles natural wording, common misspellings, shuffled word order, and many comparison phrases. Accuracy is still highest when the question contains the following elements.

| Element | What to provide | Examples |
| --- | --- | --- |
| Geography | Country or state/province | India; Bihar; Uttar Pradesh |
| Metric | PM2.5, life loss, population, standard | PM2.5; life years lost |
| Time | A year, range, or relative period | 2024; 2010-2020; last decade |
| Benchmark | WHO, national, or custom target | WHO; national std; target 15 µg/m³ |
| Operation | Value, rank, compare, trend, or filter | top 5; compare; above 30 |

### Recommended question pattern

```text
[Action] + [place/level] + [metric] + [year/period] + [benchmark]
```

Example: Compare Bihar and Uttar Pradesh life loss from 2014 to 2024 using the national standard.

### When the question is ambiguous

The chatbot asks one short clarification instead of guessing. For example, a request for top states without a country prompts for the country. A request for top 10 states every year may ask whether the user wants a period average or the single annual leader.

```text
Bot: Do you want (1) the top 10 states averaged across the period, or (2) the single most polluted state for each year?
User: 2
```

## Supported question types

### Direct values

Use direct-value questions for one location and one year. If no year is supplied, the latest available year is used. The current latest year is 2024.

- What is the PM2.5 level in Bihar?
- What was India's PM2.5 in 2020?
- What is the population of Nepal in the latest year?
- What is life-expectancy loss in Jharkhand under the national standard?

### Rankings

Rankings may be requested for countries or states/provinces. State rankings normally require a country unless the question explicitly asks for a worldwide state ranking.

- Top 10 countries by PM2.5 in 2024.
- Give top five most polluted states in Nepal.
- Which state has the highest life loss in India?
- Which countries improved the most over the last decade?

> **Ranking rule:** PM2.5 and life loss are proportional for the same benchmark, so the bot normally shows both rather than asking which one to rank.

### Threshold filters

Threshold questions return matching places with units. The parser distinguishes strict, inclusive, and exact boundaries.

| Meaning | Recognized examples | Behavior |
| --- | --- | --- |
| Strictly above | more than, greater than, above, over, exceeds, > | Value must be greater than the threshold |
| At or above | at least, no less than, >= | Threshold value is included |
| Strictly below | less than, lower than, below, under, < | Value must be lower than the threshold |
| At or below | at most, no more than, <= | Threshold value is included |
| Equal | equal to, exactly, same as, = | Only exact matches are returned |

Examples: List states in India with PM2.5 below 30. List countries with national std more than 30. How many countries have PM2.5 at least 35?

### Comparisons

The chatbot compares two countries, two states, or a country and a state. Country values are taken from GADM0; state/province values are taken from GADM1. Mixed-level answers include a level note so the user understands that the geographic units differ.

```text
Compare India and China in 2024.
Compare Bihar and Uttar Pradesh for the last decade.
Compare India and Uttar Pradesh from 2014 to 2024.
```

A period comparison shows the start value, end value, change, direction, final-year difference, and life-loss change for both places.

### Trends and time periods

Trend questions show the first year, last year, PM2.5 change, life-loss change, and whether long-term exposure improved or worsened. Relative periods end at the latest available year. Use an explicit range when exact endpoints matter.

- Show the trend for Madhesh.
- How did Delhi change from 2010 to 2024?
- Compare India and China over the past ten years.
- What was the highest PM2.5 in Uttar Pradesh during the last 20 years?

### Annual leaders and period averages

For multi-year rankings, the chatbot can calculate a period average or return the single leader for each year. If a top-N annual request could mean either, it asks the user to choose.

```text
Top 10 most polluted states in India between 2010 and 2024.
Give the most polluted state in India for each year from 2010 to 2024.
```

### Benchmarks

| Benchmark | How to request it | Data behavior |
| --- | --- | --- |
| WHO guideline | WHO, WHO guideline | Default when no benchmark is specified; uses llpp_who when available |
| National standard | national standard, national std, nat std, national limit | Uses llpp_nat/llpp_national when available |
| Custom target | target 10 µg/m³ | Calculates max(PM2.5 - target, 0) x 0.098 |

### Total life-years calculation

When requested, the chatbot calculates an aggregate using the user-defined convention below.

```text
Total person-years lost = life loss per person x population
```

> **Interpret carefully:** This aggregate is a calculated communication measure. It should not be presented as an official individual prediction or medical diagnosis.

### Reports and methodology

Use uploaded annual reports and methodology documents for definitions, policy context, interpretation, limitations, and report findings. Numeric rankings and comparisons continue to use the structured CSV data first.

- What is AQLI?
- Why does AQLI use PM2.5?
- How is life-expectancy loss calculated?
- What are the limitations of AQLI?
- Summarize the annual report's main findings.

## Conversation memory and reset

### Follow-up questions

The chatbot uses recent messages from the same conversation to interpret short follow-ups. It can retain the selected place, level, year, benchmark, comparison subject, or requested operation.

```text
User: Tell me about Uttar Pradesh.
User: Show its trend.
User: Compare it with Bihar.
User: Now use the national standard.
```

### Start a clean topic

Send the single word reset when previous context is influencing a new question.

```text
reset
```

> **Important:** reset clears the active conversational context used for future answers. It does not delete stored conversation messages from Supabase.

### When not to rely on memory

- After changing from a country question to an unrelated state question.
- After a long sequence containing several benchmarks or time periods.
- When a reply mentions a place different from the one intended.
- Before formal testing, demonstrations, or screenshots.

## Understanding answers and references

### Standard answer structure

1. Answer first: the value, ranking, trend, or comparison requested.
2. Short interpretation: included where it helps explain direction or significance.
3. Suggested next question: a relevant follow-up, when available.
4. Data coverage notice: country and state/province data only.
5. Reference line: the source level, year/range, benchmark, and conversation context when used.

### Reference labels

| Reference | Meaning |
| --- | --- |
| GADM0 CSV | Country-level structured data |
| GADM1 CSV | State/province-level structured data |
| GADM0 CSV + GADM1 CSV | Mixed country-to-state comparison using exact source levels |
| AQLI Annual Report | Narrative findings, context, and interpretation |
| AQLI Methodology document | Definitions, conversion relationship, assumptions, and limitations |
| Previous conversation context + ... | The current answer used a recent conversation selection |
| Reference checked | The bot checked the source but could not support the requested answer |

### Units

- PM2.5 concentration: µg/m³.
- Life loss: years per person unless explicitly described as total person-years.
- Population: people.
- Change: µg/m³ or years, with direction stated separately.

## Data coverage, methodology, and limitations

### Current structured data coverage

| Level | Status | Use |
| --- | --- | --- |
| GADM0 - Country | Active | Country values, rankings, filters, trends, and comparisons |
| GADM1 - State/province | Active | State/province values, rankings, filters, trends, and comparisons |
| GADM2 - District | Not currently active | District questions return a clear coverage limitation |

### Important limitations

- Not live AQI: The data represents annual long-term PM2.5, not current hourly air quality or an emergency alert.
- Data freshness: The current CSV series runs through 2024. New annual data must be uploaded before the bot can use it.
- Grounded scope: The chatbot does not invent unsupported values. Missing information produces a clear unavailable-data response.
- Population estimates: AQLI values describe estimated population-level effects, not an individual's medical outcome.
- Geographic comparison: Country-to-state comparisons are allowed but are explicitly labeled as different geographic levels.
- Language: The production parser is optimized for English. Other languages have not been fully validated.
- Message format: The webhook currently processes text messages only. Images, voice notes, documents, and other media are not answered automatically.
- Platform dependency: Replies depend on Meta WhatsApp Cloud API, Vercel, Supabase, and configured model/embedding services.
- Conversation retention: reset does not erase database records. Retention and deletion must be handled administratively.

> **User-facing disclaimer:** Every automated reply states that current structured data coverage is country and state/province level only and that district-level data is not currently available.

## Troubleshooting for users

| Symptom | Likely cause | What to do |
| --- | --- | --- |
| No reply | Webhook/platform issue, human mode, or unsupported media message | Send a text message. Wait briefly. Ask an administrator to check conversation mode and production logs. |
| Wrong place or topic | Old conversation context | Send reset, then ask the complete question again. |
| Bot asks for a country | A state ranking did not include its country | Reply with the country name, such as India or Nepal. |
| District unavailable | No active GADM2 dataset | Ask for country or state/province results. |
| No data for a year | Requested year is outside the active CSV | Use a supported year or ask for the latest available year. |
| Unexpected benchmark | Benchmark was omitted or ambiguous | State WHO, national standard, or a custom PM2.5 target explicitly. |
| Long answer | The request asks for many places or years | Request top 5, a shorter year range, or a specific location. |

### A reliable retry sequence

1. Send reset.
2. Name the geographic level and place.
3. State the metric and exact year or range.
4. State the benchmark if life loss is requested.
5. If the problem continues, share the exact question and reply with the administrator.

## Administrator guide

### Sign in

1. Open https://aqli-whatsapp-chatbot.vercel.app.
2. Sign in with the Supabase administrator email and password.
3. The application opens the conversation dashboard.

> **Security:** Never place production passwords, service-role keys, Meta tokens, or model API keys in this manual or in chat messages. Store them only in approved environment-variable systems.

### Conversation dashboard

- Search conversations by user name, phone number, or message text.
- Select a conversation to view its chronological message history.
- Unread counts reset when a conversation is opened.
- New messages and conversation updates appear through Supabase Realtime.
- Use the Knowledge base button to manage documents, CSVs, pasted text, and websites.

### AI mode and Human mode

Each conversation has a mode badge in the chat header.

| Mode | Behavior | Use when |
| --- | --- | --- |
| AI mode | The chatbot automatically processes incoming text and sends a grounded reply. | Normal automated service |
| Human mode | Incoming messages are stored, but automated replies stop. An administrator can reply manually. | Escalations, sensitive questions, or manual support |

1. Open the required conversation.
2. Select the AI mode/Human mode badge to switch modes.
3. In Human mode, type a response in the message field and send it.
4. Switch back to AI mode when automated replies should resume.

## Knowledge-base management

### Open the knowledge manager

From the conversation dashboard, select Knowledge base. The manager supports pasted text, file upload, and website import.

### Supported source types

| Source | Limits | Recommended use |
| --- | --- | --- |
| Pasted text | Up to 2,000,000 characters | FAQs, policy notes, corrections, short methodology text |
| PDF | 25 MB maximum | Annual reports and methodology reports |
| DOCX | 25 MB maximum | Structured narrative documents |
| CSV | 25 MB maximum | GADM0/GADM1 structured numeric datasets |
| TXT/Markdown | 25 MB maximum | Plain-text references and prepared notes |
| Website | Single page or up to 12 indexed site pages | Public AQLI pages and selected supporting content |

### Upload a file

1. Enter a clear source title, including level and data year where relevant.
2. Select Upload file and choose a PDF, DOCX, CSV, TXT, or Markdown file.
3. Select Import file and wait for the chunk count confirmation.
4. Confirm that the source status is Active.
5. Run a representative WhatsApp question and verify the reference line.

### CSV requirements

The current wide-year schema uses one row per geographic unit with yearly PM2.5 and life-loss columns. Common fields are shown below.

| Field family | Meaning |
| --- | --- |
| country | Country name |
| name_1 | State or province name |
| name_2 | District name; not active in the current production dataset |
| region, continent, iso_alpha3 | Geographic classification |
| population | Population used for weighted averages or aggregate calculations |
| whostandard, natstandard | WHO and national PM2.5 benchmark fields |
| pm1998 ... pm2024 | Annual average PM2.5 values |
| llpp_who_1998 ... llpp_who_2024 | Life loss per person relative to WHO |
| llpp_nat_1998 ... llpp_nat_2024 | Life loss per person relative to the national standard |

> **Replacement behavior:** Uploading a newer CSV for the same GADM level automatically deactivates older active CSV sources at that level. Verify the level classification and active status after every annual replacement.

### Import a website

1. Enter a descriptive title and a public website URL.
2. Choose Single page for one URL or Site for a limited same-site crawl.
3. Select Import website. Site mode indexes up to 12 pages per import.
4. Review pages indexed, warnings, and generated chunk count.
5. Test a question whose answer appears clearly on the imported page.

> **Website limitation:** Dynamic, login-protected, blocked, oversized, or script-only pages may not provide usable text. Import a clean PDF or pasted text when necessary.

### Manage existing sources

- Deactivate a source to stop using it without deleting it.
- Activate a source to make it available to future answers.
- Reprocess a source when extraction or indexing must be rebuilt.
- Delete a source to remove it and its associated knowledge chunks.
- Keep only the intended current GADM0 and GADM1 CSVs active.

## Operational troubleshooting

| Problem | Administrator checks | Resolution |
| --- | --- | --- |
| No WhatsApp reply | Check Vercel POST /api/webhook logs; conversation mode; Meta account status; messages webhook subscription | Restore Meta access/subscription, correct credentials, or return conversation to AI mode |
| Webhook verifies but replies fail | Check outbound Meta error and configured Phone Number ID | Update WhatsApp credentials/IDs in Vercel and redeploy |
| Wrong old data | Check active knowledge sources and CSV level classification | Upload the replacement CSV; deactivate or delete stale sources |
| Correct question uses old context | Review recent messages and resolved follow-up sequence | Ask user to send reset; reproduce question as standalone input |
| PDF/CSV upload fails | Check format, 25 MB limit, extractable text, and route logs | Clean or split the source; retry with a supported file |
| Website content not used | Check source status, indexed pages, warnings, and visible page text | Reprocess, import single page, or paste authoritative text |
| Slow response | Check grounded-answer elapsed time, model fallback, source size, and Vercel duration | Use a narrower question; review retrieval/model latency and source quality |

### Environment configuration categories

Production requires correctly configured environment variables in Vercel. Do not record values in operational documents.

- Supabase: project URL, publishable key, service-role key.
- WhatsApp: verify token, access token, Phone Number ID, Business Account ID.
- Model and embeddings: OpenRouter/model setting and embedding provider credentials as applicable.
- Application: APP_URL and NEXT_PUBLIC_APP_URL.

### Production health check

1. Confirm the latest Vercel deployment status is Ready.
2. Verify GET /api/webhook with the configured verify token returns HTTP 200.
3. Send a real inbound WhatsApp text and confirm POST /api/webhook appears in logs.
4. Confirm a grounded answer is stored in Supabase and delivered by WhatsApp.
5. Check recent error logs for Meta send failures, timeouts, and source-processing errors.

## Testing checklist and prompt library

### Release acceptance checklist

- Greeting and thanks produce natural responses.
- reset clears active context but preserves message history.
- Country direct value uses GADM0 and latest year by default.
- State direct value uses GADM1.
- Top-state request without country asks for the country.
- Strict, inclusive, and equal threshold operators return correct boundaries.
- Explicit and relative period comparisons show both places.
- Country-to-state comparison cites GADM0 + GADM1 and includes a level note.
- WHO, national std, nat std, and custom target select the intended benchmark.
- Common misspellings and joined place names are handled or clarified.
- District requests state that GADM2 is unavailable.
- Every reply includes a reference and data-coverage notice.
- Human mode stops automated replies; AI mode resumes them.

### Recommended test prompts

```text
What is India's PM2.5 in 2024?
Give top five states in Nepal by PM2.5.
List countries with national std more than 30.
List states in India with PM2.5 at or below 30.
Compare India and China between 2010 and 2020.
Compare India and Uttar Pradesh for the last decade.
Compare Bihar and Uttar Pradesh life loss under the national standard.
What is national-standard life loss for Jharkhand and Uttar Pradesh for the last two years?
Show the trend for Madhesh.
Give the most polluted state in India for each year from 2010 to 2024.
What is AQLI and how is life loss calculated?
Top 10 polluted districts in India.
```

## Glossary

| Term | Definition |
| --- | --- |
| AQLI | Air Quality Life Index; translates long-term PM2.5 exposure into estimated life-expectancy impact |
| PM2.5 | Fine particulate matter with aerodynamic diameter of 2.5 micrometers or smaller |
| GADM0 | Country-level geographic dataset |
| GADM1 | State/province-level geographic dataset |
| GADM2 | District-level geographic dataset; not currently active |
| WHO benchmark | World Health Organization PM2.5 guideline field used as the default benchmark |
| National standard | Country-specific PM2.5 standard from the active dataset |
| llpp | Life loss per person |
| Period average | Average value across the selected years for each place |
| Annual leader | The highest or lowest place for each individual year |
| AI mode | Conversation mode in which automated replies are enabled |
| Human mode | Conversation mode in which automatic replies stop and an administrator responds |
| Knowledge source | An active or inactive report, website, text, or CSV available to the chatbot |
| Grounded answer | An answer supported by the active CSV, report, methodology document, or recent conversation context |

## Support and document control

Production application: https://aqli-whatsapp-chatbot.vercel.app

WhatsApp chatbot number: +91 96547 01203

Document version: 1.0 | Issued: 4 July 2026

Update this manual whenever data coverage, benchmark rules, supported message types, administrator workflows, or production platform configuration changes.
