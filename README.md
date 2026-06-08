# Newsplitter API

Serverless REST API for the Newsplitter application, built with [Serverless Framework v4](https://www.serverless.com/) on AWS Lambda + DynamoDB.

- **Runtime:** Node.js 24.x
- **Region:** eu-north-1
- **Deployment bucket:** `newsplitter-serverless-deploys`
- **Table name:** `{stage}-newsplitter`

---

## Prerequisites

- [Node.js 24+](https://nodejs.org/)
- [AWS CLI](https://aws.amazon.com/cli/) configured with the `andrenormanlang+aws2` profile
- A [Serverless Framework](https://www.serverless.com/) account with an access key

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure credentials

Create a `.env` file in the project root (already gitignored):

```bash
SERVERLESS_ACCESS_KEY=<your-serverless-framework-access-key>
```

Serverless Framework v4 requires this key for deployment. Obtain it from your [Serverless Dashboard](https://app.serverless.com/).

### 3. Create the deployment S3 bucket (first time only)

```bash
aws s3 mb s3://newsplitter-serverless-deploys --region eu-north-1 --profile andrenormanlang+aws2
```

### 4. Create required SSM parameters (first time only)

These parameters are resolved by CloudFormation at deploy time and must exist before the first deploy:

```bash
aws ssm put-parameter \
  --name "/newsplitter/openai-key" \
  --value "<your-openai-api-key>" \
  --type String \
  --region eu-north-1 \
  --profile andrenormanlang+aws2

aws ssm put-parameter \
  --name "/newsplitter/expo-access-token" \
  --value "<your-expo-access-token>" \
  --type String \
  --region eu-north-1 \
  --profile andrenormanlang+aws2
```

> **Note:** Parameters must be type `String` (not `SecureString`) — CloudFormation's `{{resolve:ssm:...}}` syntax does not support SecureString in Lambda environment variables.

On Windows (PowerShell), quote the parameter names:

```powershell
aws ssm put-parameter `
  --name '/newsplitter/openai-key' `
  --value '<your-openai-api-key>' `
  --type String `
  --region eu-north-1 `
  --profile andrenormanlang+aws2
```

---

## Deploy

```bash
AWS_PROFILE=andrenormanlang+aws2 npx serverless deploy --stage <stage> --region eu-north-1
```

Common stages:

| Stage | Purpose |
| ----- | ------- |
| `temp-dev` | Personal development |
| `development` | Shared development |
| `production` | Production |

Example:

```bash
AWS_PROFILE=andrenormanlang+aws2 npx serverless deploy --stage temp-dev --region eu-north-1
```

### Remove a deployment

```bash
AWS_PROFILE=andrenormanlang+aws2 npx serverless remove --stage temp-dev --region eu-north-1
```

---

## Local development

```bash
AWS_PROFILE=andrenormanlang+aws2 npx serverless offline --stage temp-dev
```

API will be available at `http://localhost:3000`.

---

## Endpoints

All endpoints are defined in [serverless.yml](./serverless.yml). The base URL after deploy is printed in the deploy output as `endpoint`.

### GET /newsplitter/{url}

Fetches articles from an RSS feed, stores them in DynamoDB, and returns the last 100.

| Param | Required | Type   | Description              |
| ----- | -------- | ------ | ------------------------ |
| `url` | yes      | string | URL-encoded RSS feed URL |

---

### GET /profile/{body}

Returns profile information for the authenticated user.

---

### PUT /smart/profile

Updates profile information.

| Field        | Required | Type   | Description                                    |
| ------------ | -------- | ------ | ---------------------------------------------- |
| `nickname`   | yes      | string | Username / display name                        |
| `profilePic` | yes      | string | Profile picture URL                            |
| `imageKey`   | yes      | string | S3 key for the user avatar                     |
| `subId`      | yes      | string | Cognito sub ID (from `Auth.currentUserInfo()`) |
| `email`      | yes      | string | User email                                     |

---

### GET /comments/{body}

Returns comments for an article. Expects an article URL as `body`.

---

### POST /comments

Adds a comment (or reply) to an article.

| Field         | Required | Type   | Description                                    |
| ------------- | -------- | ------ | ---------------------------------------------- |
| `msg`         | yes      | string | Comment text                                   |
| `parentMsgId` | yes      | string | Parent comment ID, or `0` for a root comment   |
| `url`         | yes      | string | Article URL                                    |
| `rssUrl`      | yes      | string | RSS feed URL                                   |

---

### PUT /comments

Soft-deletes a comment (nullifies fields to preserve tree structure).

| Field     | Required | Type   |
| --------- | -------- | ------ |
| `id`      | yes      | string |
| `sortKey` | yes      | string |

---

### PUT /smart/article/{url}

Updates article feedback.

| Param | Required | Type   | Description |
| ----- | -------- | ------ | ----------- |
| `url` | yes      | string | Article URL |

| Field    | Required | Type   | Description                                       |
| -------- | -------- | ------ | ------------------------------------------------- |
| `action` | yes      | string | One of: `likes`, `dislikes`, `trust`, `distrust`  |

---

### GET /smart/article/{url}

Returns article metadata and feedback stats.

| Param | Required | Type   | Description |
| ----- | -------- | ------ | ----------- |
| `url` | yes      | string | Article URL |

---

### GET /smart/metadata/{url}

Returns Open Graph metadata for an article (title, image).

| Param | Required | Type   | Description |
| ----- | -------- | ------ | ----------- |
| `url` | yes      | string | Article URL |

---

### GET /smart/trending/comments

Returns articles ranked by comment activity.

---

### GET /smart/trending/interest

Returns articles ranked by like/dislike ratio (interest score).
