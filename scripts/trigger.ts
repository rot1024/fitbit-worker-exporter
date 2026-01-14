import { readFileSync, existsSync } from "fs";

function loadDevVars(): Record<string, string> {
  const devVarsPath = ".dev.vars";

  if (!existsSync(devVarsPath)) {
    console.error("Error: .dev.vars file not found.");
    console.error("Please create .dev.vars with WORKER_URL=https://your-worker.workers.dev");
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

async function main() {
  const args = process.argv.slice(2);
  let date: string | undefined;

  for (const arg of args) {
    if (arg.startsWith("--date=")) {
      date = arg.slice(7);
    }
  }

  const env = loadDevVars();

  if (!env.WORKER_URL) {
    console.error("Error: WORKER_URL not found in .dev.vars");
    console.error("Add: WORKER_URL=https://your-worker.workers.dev");
    process.exit(1);
  }

  const baseUrl = env.WORKER_URL.replace(/\/$/, "");
  const url = date ? `${baseUrl}/fetch?date=${date}` : `${baseUrl}/fetch`;

  console.log(`Triggering: ${url}`);

  try {
    const response = await fetch(url);
    const text = await response.text();

    if (response.ok) {
      console.log(`✓ Success (${response.status})`);
      console.log(text);
    } else {
      console.error(`✗ Failed (${response.status})`);
      console.error(text);
      process.exit(1);
    }
  } catch (error) {
    console.error("✗ Request failed:", (error as Error).message);
    process.exit(1);
  }
}

main();
