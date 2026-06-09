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
| Bleeding Cool | `https://bleedingcool.com/feed/` |
| Comic Book Herald | `https://www.comicbookherald.com/feed/` |
| CBR | `https://www.cbr.com/feed/` |
| The Beat | `https://www.comicsbeat.com/feed/` |
| ICv2 | `https://icv2.com/articles/news/rss.xml` |
| AIPT Comics | `https://aiptcomics.com/feed/` |
| Multiversity Comics | `https://www.multiversitycomics.com/feed/` |
| DC Comics News | `https://dccomicsnews.com/feed/` |
| Games Radar (Comics) | `https://www.gamesradar.com/comics/rss/` |
| Superhero Hype | `https://www.superherohype.com/feed/` |
| Comic Book Roundup | `https://comicbookroundup.com/feed/rss2/` |

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
- AWS CLI configured with the `andrenormanlang+aws2` profile
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
  --profile andrenormanlang+aws2
```

Store the OpenAI key in SSM (CloudFormation resolves it at deploy time):

```bash
# Bash / Git Bash (MSYS_NO_PATHCONV prevents path mangling on Windows)
MSYS_NO_PATHCONV=1 aws ssm put-parameter \
  --name "/retropop-dispatch/openai-key" \
  --value "<your-openai-api-key>" \
  --type String \
  --region eu-north-1 \
  --profile andrenormanlang+aws2
```

```powershell
# PowerShell
aws ssm put-parameter `
  --name '/retropop-dispatch/openai-key' `
  --value '<your-openai-api-key>' `
  --type String `
  --region eu-north-1 `
  --profile andrenormanlang+aws2
```

> Parameters must be type `String` — CloudFormation's `{{resolve:ssm:...}}` syntax does not support `SecureString` in Lambda environment variables.

---

## Deploy

```bash
AWS_PROFILE=andrenormanlang+aws2 npx serverless deploy \
  --stage dev \
  --region eu-north-1
```

### Remove a deployment

```bash
AWS_PROFILE=andrenormanlang+aws2 npx serverless remove \
  --stage dev \
  --region eu-north-1
```

> The DynamoDB table has `DeletionPolicy: Retain` — it is **not** managed by CloudFormation and will survive a stack removal.

---

## Local development

```bash
AWS_PROFILE=andrenormanlang+aws2 npx serverless offline --stage dev
```

API available at `http://localhost:3000`.

---

## Manually triggering scrapers

After a fresh deploy, invoke the scrapers manually to populate data without waiting for the 15-minute schedule:

```bash
# Ingest RSS articles
AWS_PROFILE=andrenormanlang+aws2 aws lambda invoke \
  --function-name retro-pop-dispatch-dev-add_articles \
  --region eu-north-1 /dev/null

# Scrape + AI-rewrite (runs up to 5 min)
AWS_PROFILE=andrenormanlang+aws2 aws lambda invoke \
  --function-name retro-pop-dispatch-dev-data_scrapping_node \
  --region eu-north-1 /dev/null
```
