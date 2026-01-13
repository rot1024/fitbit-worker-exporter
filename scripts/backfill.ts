import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import {
  FitbitClient,
  type StoredTokens,
  type TokenStorage,
  type FitbitOAuthConfig,
  type DailyData,
} from "../packages/fitbit/src/index.js";
import { saveToNotion } from "../src/notion.js";

// CLI Options
interface BackfillOptions {
  from: string;
  to: string;
  dryRun: boolean;
}

function parseArgs(args: string[]): BackfillOptions {
  const options: BackfillOptions = {
    from: "",
    to: "",
    dryRun: false,
  };

  for (const arg of args) {
    if (arg.startsWith("--from=")) {
      options.from = arg.slice(7);
    } else if (arg.startsWith("--to=")) {
      options.to = arg.slice(5);
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    }
  }

  return options;
}

function validateDate(dateStr: string): boolean {
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateStr)) return false;
  const date = new Date(dateStr);
  return !isNaN(date.getTime());
}

function generateDateRange(from: string, to: string): string[] {
  const dates: string[] = [];
  const start = new Date(from);
  const end = new Date(to);

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().split("T")[0]);
  }

  return dates;
}

// Rate Limiter (sliding window)
class RateLimiter {
  private requests: number[] = [];
  private readonly maxRequests: number;
  private readonly windowMs: number;

  constructor(maxRequests = 145, windowMs = 60 * 60 * 1000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  async waitForSlot(): Promise<void> {
    const now = Date.now();
    this.requests = this.requests.filter((t) => now - t < this.windowMs);

    if (this.requests.length >= this.maxRequests) {
      const waitTime = this.requests[0] + this.windowMs - now;
      console.log(
        `\nRate limit reached. Waiting ${Math.ceil(waitTime / 1000)}s...`
      );
      await this.sleep(waitTime + 1000);
      return this.waitForSlot();
    }

    this.requests.push(now);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Progress Reporter
class ProgressReporter {
  private total: number;
  private completed: number = 0;
  private startTime: number;
  private errors: { date: string; error: string }[] = [];

  constructor(total: number) {
    this.total = total;
    this.startTime = Date.now();
  }

  update(date: string, data: DailyData | null, error?: Error): void {
    this.completed++;

    const percent = Math.round((this.completed / this.total) * 100);
    const elapsed = Date.now() - this.startTime;
    const rate = this.completed / (elapsed / 3600000);
    const remaining = this.total - this.completed;
    const eta = remaining > 0 && rate > 0 ? remaining / rate : 0;

    const bar = this.renderProgressBar(percent);
    const etaStr = this.formatDuration(eta * 3600000);

    console.log(
      `${bar} ${percent}% | ${this.completed}/${this.total} | ${date} | ETA: ${etaStr}`
    );

    if (data) {
      const summary = this.formatDataSummary(data);
      console.log(`  ✓ ${date}: ${summary}`);
    } else if (error) {
      console.log(`  ✗ ${date}: ${error.message}`);
      this.errors.push({ date, error: error.message });
    }
  }

  private renderProgressBar(percent: number): string {
    const width = 25;
    const filled = Math.round((width * percent) / 100);
    const empty = width - filled;
    return `[${"=".repeat(filled)}${filled < width ? ">" : ""}${" ".repeat(Math.max(0, empty - 1))}]`;
  }

  private formatDataSummary(data: DailyData): string {
    const sleepHours = Math.floor(data.sleepDuration / 60);
    const sleepMins = data.sleepDuration % 60;
    const sleep = `${sleepHours}h${sleepMins}m`;
    const weight = data.weight ? `, weight=${data.weight}kg` : "";
    return `steps=${data.steps}, sleep=${sleep}${weight}`;
  }

  private formatDuration(ms: number): string {
    if (ms <= 0) return "0m";
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    if (hours > 0) {
      return `${hours}h${minutes}m`;
    }
    return `${minutes}m`;
  }

  printSummary(): void {
    console.log("\n========== Summary ==========");
    console.log(`Total: ${this.completed}/${this.total}`);
    console.log(`Success: ${this.completed - this.errors.length}`);
    console.log(`Errors: ${this.errors.length}`);

    if (this.errors.length > 0) {
      console.log("\nFailed dates:");
      for (const { date, error } of this.errors) {
        console.log(`  ${date}: ${error}`);
      }
    }
  }
}

// Retry logic
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;

      if (error instanceof Error && error.message.includes("401")) {
        throw error;
      }

      if (error instanceof Error && error.message.includes("429")) {
        console.log(`  Rate limited. Waiting 60s...`);
        await new Promise((r) => setTimeout(r, 60000));
        continue;
      }

      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 30000);
        console.log(`  Retry ${attempt + 1}/${maxRetries} in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw lastError;
}

// Load .dev.vars file
function loadDevVars(): Record<string, string> {
  const devVarsPath = ".dev.vars";

  if (!existsSync(devVarsPath)) {
    console.error("Error: .dev.vars file not found.");
    console.error("Please create .dev.vars with the following content:");
    console.error(`
FITBIT_CLIENT_ID=your_client_id
FITBIT_CLIENT_SECRET=your_client_secret
NOTION_API_KEY=your_notion_api_key
NOTION_DATA_SOURCE_ID=your_notion_database_id
`);
    process.exit(1);
  }

  const content = readFileSync(devVarsPath, "utf-8");
  const env: Record<string, string> = {};

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex > 0) {
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      env[key] = value;
    }
  }

  return env;
}

// Get tokens from KV via wrangler
function getTokensFromKV(namespaceId: string): StoredTokens {
  try {
    const result = execSync(
      `npx wrangler kv:key get tokens --namespace-id=${namespaceId}`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
    );
    return JSON.parse(result);
  } catch (error) {
    console.error("Error: Failed to get tokens from KV.");
    console.error("Make sure you are logged in: npx wrangler login");
    console.error(
      "And that OAuth authentication has been completed via /auth/login"
    );
    process.exit(1);
  }
}

// Create local token storage that syncs back to KV
function createLocalTokenStorage(
  initialTokens: StoredTokens,
  namespaceId: string
): TokenStorage {
  let tokens = initialTokens;

  return {
    async get() {
      return tokens;
    },
    async set(newTokens: StoredTokens) {
      tokens = newTokens;
      try {
        execSync(
          `npx wrangler kv:key put tokens '${JSON.stringify(newTokens)}' --namespace-id=${namespaceId}`,
          { stdio: ["pipe", "pipe", "pipe"] }
        );
        console.log("  Token refreshed and saved to KV");
      } catch (error) {
        console.error("  Warning: Failed to save refreshed token to KV");
      }
    },
  };
}

// Main
async function main() {
  const options = parseArgs(process.argv.slice(2));

  // Show usage
  if (!options.from || !options.to) {
    console.log("Usage: npm run backfill -- --from=YYYY-MM-DD --to=YYYY-MM-DD [--dry-run]");
    console.log("");
    console.log("Options:");
    console.log("  --from=YYYY-MM-DD  Start date (required)");
    console.log("  --to=YYYY-MM-DD    End date (required)");
    console.log("  --dry-run          Preview without fetching/saving");
    process.exit(1);
  }

  // Validate dates
  if (!validateDate(options.from)) {
    console.error(`Error: Invalid from date: ${options.from}`);
    process.exit(1);
  }
  if (!validateDate(options.to)) {
    console.error(`Error: Invalid to date: ${options.to}`);
    process.exit(1);
  }
  if (options.from > options.to) {
    console.error("Error: from date must be before or equal to to date");
    process.exit(1);
  }

  // Load config
  const env = loadDevVars();
  const requiredKeys = [
    "FITBIT_CLIENT_ID",
    "FITBIT_CLIENT_SECRET",
    "NOTION_API_KEY",
    "NOTION_DATA_SOURCE_ID",
  ];
  for (const key of requiredKeys) {
    if (!env[key]) {
      console.error(`Error: Missing ${key} in .dev.vars`);
      process.exit(1);
    }
  }

  // KV namespace ID from wrangler.toml
  const KV_NAMESPACE_ID = "40cac582df3a486692cea96d954847cd";

  // Generate date range
  const dates = generateDateRange(options.from, options.to);
  const estimatedHours = (dates.length / 48).toFixed(1);

  console.log("");
  console.log("Fitbit Backfill Tool");
  console.log("====================");
  console.log(`Date range: ${options.from} to ${options.to} (${dates.length} days)`);
  console.log(`Estimated time: ~${estimatedHours} hours (at ~48 days/hour)`);
  console.log("");

  if (options.dryRun) {
    console.log("DRY RUN - No data will be fetched or saved");
    console.log("");
    console.log("Dates to process:");
    for (const date of dates.slice(0, 10)) {
      console.log(`  ${date}`);
    }
    if (dates.length > 10) {
      console.log(`  ... and ${dates.length - 10} more`);
    }
    return;
  }

  // Get tokens
  console.log("Getting tokens from KV...");
  const tokens = getTokensFromKV(KV_NAMESPACE_ID);
  console.log("Tokens loaded successfully");
  console.log("");

  // Create services
  const oauthConfig: FitbitOAuthConfig = {
    clientId: env.FITBIT_CLIENT_ID,
    clientSecret: env.FITBIT_CLIENT_SECRET,
    redirectUri: "",
  };
  const tokenStorage = createLocalTokenStorage(tokens, KV_NAMESPACE_ID);
  const client = new FitbitClient(oauthConfig, tokenStorage);
  const rateLimiter = new RateLimiter(145);
  const progress = new ProgressReporter(dates.length);

  // Process each date
  for (const date of dates) {
    try {
      // Reserve 3 slots for this day's requests
      await rateLimiter.waitForSlot();
      await rateLimiter.waitForSlot();
      await rateLimiter.waitForSlot();

      const data = await withRetry(() => client.getDailyData(date));
      await saveToNotion(env.NOTION_API_KEY, env.NOTION_DATA_SOURCE_ID, data);

      progress.update(date, data);
    } catch (error) {
      progress.update(date, null, error as Error);

      if ((error as Error).message.includes("401")) {
        console.error("\nAuthentication failed. Please re-authenticate via /auth/login");
        break;
      }
    }
  }

  progress.printSummary();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
