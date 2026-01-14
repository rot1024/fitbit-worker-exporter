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
  DEBUG_MODE?: string;
  TZ_OFFSET?: string; // Timezone offset in hours (e.g., "9" for JST, "-5" for EST)
  DISCORD_WEBHOOK_URL?: string;
  SLACK_WEBHOOK_URL?: string;
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

// Manual fetch (for testing, requires DEBUG_MODE)
app.get("/fetch", async (c) => {
  if (c.env.DEBUG_MODE !== "true") {
    return c.text("Not Found", 404);
  }

  const dateParam = c.req.query("date");
  const tzOffset = parseInt(c.env.TZ_OFFSET ?? "9", 10);
  const date = dateParam ?? getYesterdayDate(tzOffset);

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
    return c.json({ success: true, date });
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

function getYesterdayDate(tzOffset: number): string {
  const now = new Date();
  const localNow = new Date(now.getTime() + tzOffset * 60 * 60 * 1000);
  localNow.setDate(localNow.getDate() - 1);
  return localNow.toISOString().split("T")[0];
}

async function sendErrorNotification(
  env: Bindings,
  date: string,
  error: Error
): Promise<void> {
  const message = `Fitbit Worker Exporter: Failed to fetch/save data for ${date}\nError: ${error.message}`;

  const promises: Promise<Response>[] = [];

  if (env.DISCORD_WEBHOOK_URL) {
    promises.push(
      fetch(env.DISCORD_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: message }),
      })
    );
  }

  if (env.SLACK_WEBHOOK_URL) {
    promises.push(
      fetch(env.SLACK_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: message }),
      })
    );
  }

  await Promise.allSettled(promises);
}

// Cron handler
async function scheduled(
  _event: ScheduledEvent,
  env: Bindings,
  _ctx: ExecutionContext
): Promise<void> {
  const tzOffset = parseInt(env.TZ_OFFSET ?? "9", 10);
  const date = getYesterdayDate(tzOffset);

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
    const error = err instanceof Error ? err : new Error(String(err));
    await sendErrorNotification(env, date, error);
    throw err;
  }
}

export default {
  fetch: app.fetch,
  scheduled,
};
