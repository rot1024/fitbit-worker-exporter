import { Hono } from "hono";
import {
  FitbitClient,
  generateState,
  createAuthUrl,
  exchangeCode,
  type FitbitOAuthConfig,
  type StoredTokens,
  type TokenStorage,
} from "../packages/fitbit/src/index.js";
import { saveToNotion } from "./notion.js";

type Bindings = {
  KV: KVNamespace;
  FITBIT_CLIENT_ID: string;
  FITBIT_CLIENT_SECRET: string;
  NOTION_API_KEY: string;
  NOTION_DATA_SOURCE_ID: string;
  OAUTH_REDIRECT_URI: string;
};

const app = new Hono<{ Bindings: Bindings }>();

function getOAuthConfig(env: Bindings): FitbitOAuthConfig {
  return {
    clientId: env.FITBIT_CLIENT_ID,
    clientSecret: env.FITBIT_CLIENT_SECRET,
    redirectUri: env.OAUTH_REDIRECT_URI,
  };
}

function createTokenStorage(kv: KVNamespace): TokenStorage {
  return {
    async get(): Promise<StoredTokens | null> {
      const data = await kv.get("tokens", "json");
      return data as StoredTokens | null;
    },
    async set(tokens: StoredTokens): Promise<void> {
      await kv.put("tokens", JSON.stringify(tokens));
    },
  };
}

// OAuth: Login
app.get("/auth/login", async (c) => {
  const state = generateState();
  await c.env.KV.put("oauth_state", state, { expirationTtl: 600 });

  const authUrl = createAuthUrl(getOAuthConfig(c.env), state);
  return c.redirect(authUrl);
});

// OAuth: Callback
app.get("/auth/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const error = c.req.query("error");

  if (error) {
    return c.text(`OAuth error: ${error}`, 400);
  }

  if (!code || !state) {
    return c.text("Missing code or state", 400);
  }

  const storedState = await c.env.KV.get("oauth_state");
  if (state !== storedState) {
    return c.text("Invalid state", 400);
  }

  try {
    const tokens = await exchangeCode(getOAuthConfig(c.env), code);
    await c.env.KV.put("tokens", JSON.stringify(tokens));
    await c.env.KV.delete("oauth_state");

    console.log("OAuth authentication successful");
    return c.text("Authentication successful! You can close this window.");
  } catch (err) {
    console.error("OAuth authentication failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return c.text(`Authentication failed: ${message}`, 500);
  }
});

// Manual fetch (for testing)
app.get("/fetch", async (c) => {
  const dateParam = c.req.query("date");
  const date = dateParam ?? getYesterdayDate();

  console.log(`Fetching data for ${date}`);

  try {
    const client = new FitbitClient(
      getOAuthConfig(c.env),
      createTokenStorage(c.env.KV)
    );
    const data = await client.getDailyData(date);

    console.log(`Fitbit data fetched for ${date}:`, data);

    await saveToNotion(c.env.NOTION_API_KEY, c.env.NOTION_DATA_SOURCE_ID, data);

    console.log(`Successfully saved data for ${date}`);
    return c.json({ success: true, data });
  } catch (err) {
    console.error(`Failed to fetch/save data for ${date}:`, err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return c.json({ success: false, error: message }, 500);
  }
});

// Health check
app.get("/", (c) => {
  return c.text("Fitbit Worker Exporter is running!");
});

function getYesterdayDate(): string {
  const now = new Date();
  now.setDate(now.getDate() - 1);
  return now.toISOString().split("T")[0];
}

// Cron handler
async function scheduled(
  _event: ScheduledEvent,
  env: Bindings,
  _ctx: ExecutionContext
): Promise<void> {
  const date = getYesterdayDate();

  console.log(`[Cron] Fetching data for ${date}`);

  try {
    const client = new FitbitClient(
      getOAuthConfig(env),
      createTokenStorage(env.KV)
    );
    const data = await client.getDailyData(date);

    console.log(`[Cron] Fitbit data fetched for ${date}:`, data);

    await saveToNotion(env.NOTION_API_KEY, env.NOTION_DATA_SOURCE_ID, data);

    console.log(`[Cron] Successfully saved data for ${date}`);
  } catch (err) {
    console.error(`[Cron] Failed to fetch/save data for ${date}:`, err);
    throw err;
  }
}

export default {
  fetch: app.fetch,
  scheduled,
};
