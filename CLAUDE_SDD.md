# retro-pop-dispatch (Backend) — SDD Detail

> Repo-specific SDD context for the **`retro-pop-dispatch` backend**: the serverless comics-news
> aggregation & AI-rewrite service. Read the workspace constitution first:
> [`../CLAUDE_SDD.md`](../CLAUDE_SDD.md). This file owns the backend's stack, directory map, data
> model, API surface, env/secrets, and commands. **Paths in this file are relative to this repo**
> (`retro-pop-dispatch/`); a bare `src/...` means `retro-pop-dispatch/src/...`. In `specs/` artifacts,
> prefix with `retro-pop-dispatch/`.

---

## 1. Tech stack (authoritative)

| Concern | Choice | Notes |
| --- | --- | --- |
| Runtime | **Node.js 24.x** on **AWS Lambda** | Region **eu-north-1** (Stockholm). |
| Language | **JavaScript** (CommonJS, `*.js`) | No TypeScript here — don't introduce it without a plan. |
| Framework | **Serverless Framework v4** | `serverless.yml` is the deployment + function source of truth. |
| Local dev | **serverless-offline** | `serverless invoke local` / `serverless offline`. |
| Persistence | **AWS DynamoDB** (single table) | `@aws-sdk/client-dynamodb` + `@aws-sdk/lib-dynamodb`. |
| AI rewrite | **OpenAI** (`openai`) + `gpt-tokenizer` | Editorial rewrite of scraped articles. |
| Scraping | `cheerio`, `open-graph-scraper`, `node-fetch` (browser UA to bypass 403s) | |
| RSS | `rss-parser`, `xmldoc` | 12 comics-news feeds. |
| Other AWS | S3, SNS, Cognito IDP, CloudWatch Logs (`@aws-sdk/client-*`) | |
| Notifications | `expo-server-sdk` | |
| Tests | **jest** (`babel-jest`, `@babel/preset-env`) | `tests/setup.js` runs first. |
| Package manager | **npm** | Frontend uses pnpm — don't cross them. |

> **Secrets are not in `.env` for runtime.** The OpenAI key is stored in **AWS SSM** and resolved by
> CloudFormation at deploy time (`{{resolve:ssm:/retropop-dispatch/openai-key}}`). `.env` holds only
> the Serverless Framework access key for local CLI. See §6.

---

## 2. Architecture & directory map

```text
serverless.yml                  # functions, events (schedules + HTTP), resources, SSM wiring
handler.js                      # legacy/root entry (see serverless.yml for active handlers)
src/
├── functions/                  # Lambda entrypoints (each exports `main`)
│   ├── add_articles.js           # scheduled (15 min): RSS → DynamoDB feed items
│   ├── data_scrapping_node.js    # scheduled (15 min): scrape + OpenAI rewrite (timeout 300s)
│   ├── get_article.js            # HTTP: GET /smart/article/{url} → AI-rewritten article
│   └── test_channel_fetch.js     # TEMPORARY diagnostic — remove after 403 debugging
├── handlers/
│   └── get.js                    # HTTP: GET /dispatch/{url} → feed items for an RSS URL
└── libs/                       # shared logic
    ├── dynamodb-lib.js           # DynamoDB document-client wrapper
    ├── handler-lib.js            # HTTP handler wrapper (errors, response shaping)
    ├── response-lib.js           # success/failure response helpers
    ├── openAIInterface.js        # OpenAI client wrapper
    ├── gpt-config.js             # model/config + tokenizer budgeting
    ├── createPrompt.js           # rewrite prompt construction
    ├── rephrase-lib.js           # rewrite orchestration
    ├── dl_xml_utils.js           # RSS/XML download + parse helpers
    ├── user_article_interaction_lib.js
    ├── defs.js                   # constants/definitions (feed list, etc.)
    └── utils.js
resources/
├── dynamodb-table.yml          # currently empty (Resources: {}) — the table + GSIs are managed OUTSIDE CloudFormation (table pre-exists, DeletionPolicy: Retain)
└── api-gateway-errors.yml      # gateway error responses (CORS on errors)
mocks/                          # Lambda event payloads for `serverless invoke local`
tests/                          # jest specs (+ setup.js)
amplify/  exp_cfg/              # auxiliary config
```

**Functions ↔ events** (from `serverless.yml`):

| Function | Handler | Trigger |
| --- | --- | --- |
| `add_articles` | `src/functions/add_articles.main` | schedule `rate(15 minutes)` |
| `data_scrapping_node` | `src/functions/data_scrapping_node.main` | schedule `rate(15 minutes)`, timeout 300s |
| `get` | `src/handlers/get.main` | HTTP `GET /dispatch/{url}` (CORS) |
| `smart_get_article` | `src/functions/get_article.main` | HTTP `GET /smart/article/{url}` (CORS) |
| `test_channel_fetch` | `src/functions/test_channel_fetch.main` | manual (temporary) |

---

## 3. Data model (DynamoDB, single table)

One table per stage: `<stage>-retropop-dispatch` (e.g. `dev-retropop-dispatch`). `id` is always the
article URL; `sortKey` discriminates the records. Each article produces **two records**:

| `sortKey` value | Record | Key fields | Written by |
| --- | --- | --- | --- |
| the RSS feed URL | raw per-source feed entry | `title`, `description`, `pubTS`, `addedTS`, `amount` (= `pubTS`), `rssUrl` | `add_articles` |
| `"articles"` | the **rewritten article = the scroll-feed item** users see (served by `/smart/article/{url}?sortKey=articles`) | `rwTitle`, `rwDescription`, `rwBody`, `orgBody`, `slug`, `amount` (= `pubTS`), `ttlTS` | `data_scrapping_node` |

- **`amount` mirrors `pubTS`** (a recency timestamp, **not** engagement) — so `sortKey-amount-index`
  doubles as a recency index: query `sortKey = "articles"`, `amount >= cutoff` (descending) for recent
  scroll-feed articles in **one** call, no per-source fan-out.
- Other records reuse the table: `synchMeta` (per-source sync metadata, `id = rssUrl`); the singular
  `"article"` sortKey is the **subjects config** (`id = "subjects"`) plus some legacy helpers — it is
  **not** the article body; config lives at `id = "config"`, `sortKey = "gpt-models"`.
- **TTL** on `ttlTS` — processed articles expire **4 days** after ingestion.
- **`DeletionPolicy: Retain`** on the table — it survives `serverless remove` and is **not** managed by
  CloudFormation for deletion. A plan that "drops" or recreates the table is wrong; state migrations
  explicitly.

**Active GSIs:**

| Index | Hash key | Sort key | Used by |
| --- | --- | --- | --- |
| `sortKey-amount-index` | `sortKey` | `amount` (= `pubTS`) | `get` (feed query); recency queries (`sortKey="articles"`, `amount >= cutoff`) |
| `sortKey-addedTS-index` | `sortKey` | `addedTS` | `data_scrapping_node` (find unprocessed) |

A plan that adds an access pattern must say whether it needs a new GSI (and the cost). The table and
its GSIs are **not** managed by CloudFormation (`resources/dynamodb-table.yml` is empty; the table
pre-exists with `DeletionPolicy: Retain`) — so a GSI/attribute change is a **manual DynamoDB
operation** that the plan documents explicitly, **not** a `dynamodb-table.yml` edit.

---

## 4. API surface (consumed only by the frontend)

Base URL (dev): `https://bue12b3514.execute-api.eu-north-1.amazonaws.com/dev` — the frontend points at
this via `RETROPOP_DISPATCH_API_URL`.

### `GET /dispatch/{url}` — feed items for an RSS URL

| Param | Type | Description |
| --- | --- | --- |
| `url` | path | URL-encoded JSON: `encodeURIComponent(JSON.stringify({ rssUrl }))` |

### `GET /smart/article/{url}` — AI-rewritten article

| Param | Type | Description |
| --- | --- | --- |
| `url` | path | `encodeURIComponent(articleUrl)` |
| `sortKey` | query | Must be `"articles"` to get the processed item |

> Any change to these shapes is a **cross-repo contract change** — update the frontend in the same
> plan (workspace §3).

### RSS sources (12)

CBR · Bleeding Cool · The Beat · ICv2 · AIPT Comics · Comic Book Herald · Graphic Policy · Broken
Frontier · 13th Dimension · Den of Geek (Comics) · Comic Book (comicbook.com) · Comics Alliance.
(The canonical list lives in code — `src/libs/defs.js` — keep README + code in sync.)

---

## 5. Conventions a plan must follow

- **New Lambdas are declared in `serverless.yml`** with an explicit handler path
  (`src/functions/<name>.main` or `src/handlers/<name>.main`) and event(s). Don't add an entrypoint
  without wiring it there.
- **Reuse the libs.** HTTP handlers go through `handler-lib.js` / `response-lib.js`; all DynamoDB
  access through `dynamodb-lib.js`. **OpenAI** is called in `rephrase-lib.js` via raw
  `fetch("https://api.openai.com/v1/chat/completions")` with `Authorization: Bearer ${defs.OPEN_AI_KEY}`,
  the model from `getGptConfig()` (`gpt-config.js`, DynamoDB-overridable), and `gpt-tokenizer` for
  token budgeting. For **structured output**, pass `response_format: { type: "json_schema", json_schema: { strict: true, schema } }` (see `requestSubjectClassification`). (`openAIInterface.js`'s
  `OpenAIApi` wrapper is **legacy/unused** — don't build on it.)
- **Respect the single-table + `sortKey` model.** New data is a new `sortKey` discriminator or a new
  attribute, not a new table, unless justified.
- **Token budgeting matters.** Rewrite prompts are tokenizer-bounded (`gpt-tokenizer`) — keep new
  prompt logic in `createPrompt.js` / `rephrase-lib.js` and stay within the configured budget.
- **Validate/parse defensively.** Scraped HTML and model output are untrusted — validate shape before
  persisting (workspace Constitution §5).
- **Tests live in `tests/`** as `*.test.js` and run under jest; mirror an existing spec's style.
- **Style:** JavaScript/CommonJS, match the surrounding file. No TypeScript without a plan.

---

## 6. Environment & secrets

Local CLI `.env` (root of this repo):

```bash
SERVERLESS_ACCESS_KEY=        # Serverless Framework v4 access key (CLI only)
```

Deploy-time secret (in AWS SSM, resolved by CloudFormation — **not** committed, **not** in `.env`):

```text
/retropop-dispatch/openai-key   # type: String (SecureString unsupported by {{resolve:ssm}} in Lambda env)
```

AWS access is via a configured CLI profile (`AWS_PROFILE=<profile>`) with DynamoDB + SSM permissions.
Deployment bucket: `retropop-dispatch-serverless-deploys`.

Rule: new secrets go in **SSM** and are referenced from `serverless.yml`; they never land in `.env`,
in code, or in CloudWatch logs.

---

## 7. Commands

```bash
npm install
npm test                                   # jest

# Local invoke (hits the real DynamoDB table; no deploy)
AWS_PROFILE=<profile> npx serverless invoke local --function get --path mocks/get-cbr.json
AWS_PROFILE=<profile> npx serverless invoke local --function smart_get_article --path mocks/get_article.json
AWS_PROFILE=<profile> npx serverless invoke local --function add_articles
AWS_PROFILE=<profile> npx serverless invoke local --function data_scrapping_node

# Local HTTP emulation
AWS_PROFILE=<profile> npx serverless offline --stage dev      # http://localhost:3000

# Deploy / remove
AWS_PROFILE=<profile> npx serverless deploy --stage dev --region eu-north-1
AWS_PROFILE=<profile> npx serverless remove --stage dev --region eu-north-1   # table is RETAINED
```

> `mocks/get_article.json` references a real CBR article URL; if it has expired (4-day TTL), refresh it
> from the output of `get-cbr.json`.

**Definition of done for a backend implement task:** code matches the plan, `npm test` passes (add/
update jest specs for new logic), `serverless invoke local` (or `offline`) demonstrates the handler,
and the spec's acceptance criteria are demonstrably met. Schedule/IAM/GSI changes are reflected in
`serverless.yml` / `resources/`.

---

## 8. Spec template

Backend features use the shared templates in [`../specs/_template/`](../specs/_template/) — set
`Surface / target repo(s): retro-pop-dispatch`, and use the **backend** variants of the plan/tasks
sections. See [`../specs/README.md`](../specs/README.md).

---

## 9. Constitution addenda (backend-specific)

These **extend** the workspace Constitution ([`../CLAUDE_SDD.md`](../CLAUDE_SDD.md) §4):

1. **Secrets live in AWS SSM**, referenced from `serverless.yml` — never in `.env`, code, or logs.
2. **Persistence is the single DynamoDB table.** Don't add a second store; respect the `sortKey`
   model, the 4-day TTL, and `DeletionPolicy: Retain` (never plan to drop/recreate the table casually).
3. **Every Lambda is declared in `serverless.yml`** with its handler + events; no orphan entrypoints.
4. **Reuse `libs/`** for DynamoDB, HTTP responses, and OpenAI access; respect token budgeting.
5. **Defensively validate** scraped/model output before persisting.
6. **`npm test` must pass**; new logic gets jest coverage.
7. **API shape changes are cross-repo contract changes** — update the frontend in the same plan.
