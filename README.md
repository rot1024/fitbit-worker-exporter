# Fitbit Worker Exporter

A Cloudflare Worker that automatically fetches daily Fitbit data and saves it to a Notion database.

## Features

- Fetch data from Fitbit API (calories, steps, distance, sleep)
- Auto-save to Notion database
- Daily scheduled execution via Cron Trigger (6:00 AM JST)
- Built-in OAuth 2.0 authentication flow

## Collected Data

| Data | Description |
|------|-------------|
| Calories | Calories burned (kcal) |
| Steps | Step count |
| Distance | Distance traveled (km) |
| Sleep Duration | Total sleep time (minutes) |
| Sleep Efficiency | Sleep efficiency (%) |
| Deep Sleep | Deep sleep time (minutes) |
| Light Sleep | Light sleep time (minutes) |
| REM Sleep | REM sleep time (minutes) |
| Awake | Awake time (minutes) |

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Create Fitbit App

1. Create an app at [Fitbit Dev](https://dev.fitbit.com/apps/new)
2. OAuth 2.0 Application Type: **Personal**
3. Callback URL: `https://your-worker.your-subdomain.workers.dev/auth/callback`
4. Note down the Client ID and Client Secret

### 3. Create Notion Integration

1. Create a new integration at [Notion Integrations](https://www.notion.so/my-integrations)
2. Note down the API Key
3. Create a Notion database and connect the integration
4. Note down the data source ID (the part between `notion.so/` and `?v=` in the URL)

**Notion Database Properties:**

| Property Name | Type |
|---------------|------|
| Date | Date |
| Calories | Number |
| Steps | Number |
| Distance | Number |
| Sleep Duration | Number |
| Sleep Efficiency | Number |
| Deep Sleep | Number |
| Light Sleep | Number |
| REM Sleep | Number |
| Awake | Number |

### 4. Create KV Namespace

```bash
wrangler kv:namespace create KV
```

Add the output ID to `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "KV"
id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

### 5. Configure Secrets

```bash
wrangler secret put FITBIT_CLIENT_ID
wrangler secret put FITBIT_CLIENT_SECRET
wrangler secret put NOTION_API_KEY
wrangler secret put NOTION_DATA_SOURCE_ID
wrangler secret put OAUTH_REDIRECT_URI
```

`OAUTH_REDIRECT_URI` should be in the format `https://your-worker.your-subdomain.workers.dev/auth/callback`.

### 6. Deploy

```bash
npm run deploy
```

### 7. OAuth Authentication

Visit the following URL in your browser to complete Fitbit authentication:

```
https://your-worker.your-subdomain.workers.dev/auth/login
```

## Usage

### Automatic Execution

Data from the previous day is automatically fetched and saved to Notion daily at UTC 21:00 (JST 6:00).

### Manual Execution

```bash
# Fetch yesterday's data
curl https://your-worker.workers.dev/fetch

# Fetch data for a specific date
curl https://your-worker.workers.dev/fetch?date=2024-01-15
```

## Development

```bash
# Start dev server
npm run dev

# Type check
npm run typecheck

# Deploy
npm run deploy
```

## Directory Structure

```
fitbit-worker-exporter/
├── packages/
│   └── fitbit/           # Standalone Fitbit library (reusable)
│       ├── src/
│       │   ├── index.ts
│       │   ├── client.ts
│       │   ├── oauth.ts
│       │   └── types.ts
│       └── package.json
├── src/
│   ├── index.ts          # Hono app
│   └── notion.ts         # Notion integration
├── wrangler.toml
└── package.json
```

## Using Fitbit Library Standalone

The `packages/fitbit` can be used as an independent library in other projects:

```typescript
import { FitbitClient, createAuthUrl, exchangeCode } from "@rot1024/fitbit";

const client = new FitbitClient(config, storage);
const data = await client.getDailyData("2024-01-15");
```

## License

MIT
