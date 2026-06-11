# retro-pop-dispatch

Serverless comics news backend for [Retro Pop Comics](https://retro-pop-comics.com). Aggregates RSS feeds from 11 comics news sources, scrapes full article content, and uses OpenAI to rewrite each article with an editorial voice. Consumed exclusively by the `retro-pop` Next.js frontend.

- **Runtime:** Node.js 24.x on AWS Lambda
- **Region:** eu-north-1 (Stockholm)
- **Stage:** `dev` → table `dev-retropop-dispatch`
- **Deployment bucket:** `retropop-dispatch-serverless-deploys`

---

## Architecture

```text
RSS feeds (every 15 min)
  └─► add_articles Lambda
        └─► DynamoDB  (feed item: sortKey = rssUrl)

Unprocessed articles (every 15 min)
  └─► data_scrapping_node Lambda
        ├─► Scrapes full HTML (browser User-Agent to bypass 403s)
        ├─► GPT-4 rewrites title, description, and body
        └─► DynamoDB  (processed item: sortKey = "articles")

retro-pop frontend
  ├─► GET /dispatch/{url}         → feed items for a given RSS URL
  └─► GET /smart/article/{url}   → AI-rewritten article by URL
```

### DynamoDB data model

Each article produces two records in the same table, differentiated by `sortKey`:

| `sortKey` value | Contains | Written by |
| --- | --- | --- |
| RSS feed URL | pubTS, title, description, rssUrl, amount (engagement) | `add_articles` |
| `"articles"` | rwBody, rwTitle, rwDescription, orgBody, ttlTS | `data_scrapping_node` |

TTL is enabled on the `ttlTS` attribute — articles expire **4 days** after ingestion.

### Active GSIs

| Index | Hash key | Sort key | Used by |
| --- | --- | --- | --- |
| `sortKey-amount-index` | sortKey | amount | `get` (feed query) |
| `sortKey-addedTS-index` | sortKey | addedTS | `data_scrapping_node` (find unprocessed) |

---

## RSS Sources

| Source | Feed URL |
| --- | --- |
| CBR | `https://www.cbr.com/feed/` |
| Bleeding Cool | `https://bleedingcool.com/feed/` |
| The Beat | `https://www.comicsbeat.com/feed/` |
| ICv2 | `https://icv2.com/rss` |
| AIPT Comics | `https://aiptcomics.com/feed/` |
| Comic Book Herald | `https://www.comicbookherald.com/feed/` |
| Graphic Policy | `https://www.graphicpolicy.com/feed/` |
| Broken Frontier | `https://brokenfrontier.com/feed/` |
| 13th Dimension | `https://13thdimension.com/feed/` |
| Den of Geek (Comics) | `https://www.denofgeek.com/comics/feed/` |
| Comic Book (comicbook.com) | `https://comicbook.com/category/comics/feed/` |
| Comics Alliance | `https://www.comicsalliance.com/feed/` |

---

## API Endpoints

Base URL (dev): `https://bue12b3514.execute-api.eu-north-1.amazonaws.com/dev`

### `GET /dispatch/{url}`

Returns feed items for a given RSS URL.

| Param | Type | Description |
| --- | --- | --- |
| `url` | path | URL-encoded JSON: `encodeURIComponent(JSON.stringify({ rssUrl }))` |

### `GET /smart/article/{url}`

Returns the AI-rewritten article for a given article URL.

| Param | Type | Description |
| --- | --- | --- |
| `url` | path | `encodeURIComponent(articleUrl)` |
| `sortKey` | query | Must be `"articles"` to get the processed item |

---

## Prerequisites

- Node.js 24+
- AWS CLI configured with an IAM profile that has DynamoDB and SSM access
- Serverless Framework account (access key for v4)

---

## Setup

```bash
npm install
```

Create `.env` in the project root:

```bash
SERVERLESS_ACCESS_KEY=<your-serverless-framework-access-key>
```

### First-time AWS setup

Create the deployment bucket:

```bash
aws s3 mb s3://retropop-dispatch-serverless-deploys \
  --region eu-north-1 \
  --profile <your-aws-profile>
```

Store the OpenAI key in SSM (CloudFormation resolves it at deploy time):

```bash
# Bash / Git Bash (MSYS_NO_PATHCONV prevents path mangling on Windows)
MSYS_NO_PATHCONV=1 aws ssm put-parameter \
  --name "/retropop-dispatch/openai-key" \
  --value "<your-openai-api-key>" \
  --type String \
  --region eu-north-1 \
  --profile <your-aws-profile>
```

```powershell
# PowerShell
aws ssm put-parameter `
  --name '/retropop-dispatch/openai-key' `
  --value '<your-openai-api-key>' `
  --type String `
  --region eu-north-1 `
  --profile <your-aws-profile>
```

> Parameters must be type `String` — CloudFormation's `{{resolve:ssm:...}}` syntax does not support `SecureString` in Lambda environment variables.

---

## Deploy

```bash
AWS_PROFILE=<your-aws-profile> npx serverless deploy \
  --stage dev \
  --region eu-north-1
```

### Remove a deployment

```bash
AWS_PROFILE=<your-aws-profile> npx serverless remove \
  --stage dev \
  --region eu-north-1
```

> The DynamoDB table has `DeletionPolicy: Retain` — it is **not** managed by CloudFormation and will survive a stack removal.

---

## Local development

```bash
AWS_PROFILE=<your-aws-profile> npx serverless offline --stage dev
```

API available at `http://localhost:3000`.

---

## Local testing with mocks

The `mocks/` directory contains pre-built Lambda event payloads for each HTTP handler. Use `serverless invoke local` to run a handler against the real DynamoDB table without deploying:

```bash
# Feed articles for a given RSS source
AWS_PROFILE=<your-aws-profile> npx serverless invoke local --function get --path mocks/get-cbr.json
AWS_PROFILE=<your-aws-profile> npx serverless invoke local --function get --path mocks/get-bleedingcool.json
AWS_PROFILE=<your-aws-profile> npx serverless invoke local --function get --path mocks/get-comicsbeat.json
AWS_PROFILE=<your-aws-profile> npx serverless invoke local --function get --path mocks/get-icv2.json

# A single AI-rewritten article (URL must exist in DynamoDB)
AWS_PROFILE=<your-aws-profile> npx serverless invoke local --function smart_get_article --path mocks/get_article.json
```

The scheduled scrapers have no event payload and can be invoked directly:

```bash
# Ingest RSS articles into DynamoDB
AWS_PROFILE=<your-aws-profile> npx serverless invoke local --function add_articles

# Scrape and AI-rewrite unprocessed articles (runs up to 5 min)
AWS_PROFILE=<your-aws-profile> npx serverless invoke local --function data_scrapping_node
```

> `get_article.json` contains a real article URL from the CBR feed. If the article has expired (TTL is 4 days), replace the `url` value with a fresh URL from the output of `get-cbr.json`.

---

## Manually triggering scrapers

After a fresh deploy, invoke the scrapers manually to populate data without waiting for the 15-minute schedule:

```bash
# Ingest RSS articles
AWS_PROFILE=<your-aws-profile> aws lambda invoke \
  --function-name retro-pop-dispatch-dev-add_articles \
  --region eu-north-1 /dev/null

# Scrape + AI-rewrite (runs up to 5 min)
AWS_PROFILE=<your-aws-profile> aws lambda invoke \
  --function-name retro-pop-dispatch-dev-data_scrapping_node \
  --region eu-north-1 /dev/null
```
