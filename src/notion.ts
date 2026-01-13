import type { DailyData } from "../packages/fitbit/src/index.js";

const NOTION_API_BASE = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

interface NotionResponse {
  results: { id: string }[];
}

async function notionRequest<T>(
  apiKey: string,
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const response = await fetch(`${NOTION_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Notion API error: ${response.status} ${error}`);
  }

  return response.json() as Promise<T>;
}

function addNumberProperty(
  properties: Record<string, unknown>,
  name: string,
  value: number | undefined,
  options: { round?: boolean; skipZero?: boolean } = {}
): void {
  if (value === undefined) return;
  if (options.skipZero && value === 0) return;

  properties[name] = {
    number: options.round ? Math.round(value * 100) / 100 : value,
  };
}

export async function saveToNotion(
  apiKey: string,
  databaseId: string,
  data: DailyData
): Promise<void> {
  // Check for existing entry with same date
  const existing = await notionRequest<NotionResponse>(
    apiKey,
    "POST",
    `/databases/${databaseId}/query`,
    {
      filter: {
        property: "Date",
        date: {
          equals: data.date,
        },
      },
    }
  );

  const isUpdate = existing.results.length > 0;

  // Build properties - only include non-zero values for updates
  const properties: Record<string, unknown> = {
    Date: {
      date: {
        start: data.date,
      },
    },
  };

  // For updates, skip zero values to preserve existing data
  const skipZero = isUpdate;

  // Activity data
  addNumberProperty(properties, "Calories", data.calories, { skipZero });
  addNumberProperty(properties, "Steps", data.steps, { skipZero });
  addNumberProperty(properties, "Distance", data.distance, { round: true, skipZero });

  // Sleep data
  addNumberProperty(properties, "Sleep Duration", data.sleepDuration, { skipZero });
  addNumberProperty(properties, "Sleep Efficiency", data.sleepEfficiency, { skipZero });
  addNumberProperty(properties, "Deep Sleep", data.deepSleep, { skipZero });
  addNumberProperty(properties, "Light Sleep", data.lightSleep, { skipZero });
  addNumberProperty(properties, "REM Sleep", data.remSleep, { skipZero });
  addNumberProperty(properties, "Awake", data.awake, { skipZero });

  // Weight data
  addNumberProperty(properties, "Weight", data.weight, { round: true, skipZero });
  addNumberProperty(properties, "BMI", data.bmi, { round: true, skipZero });
  addNumberProperty(properties, "Body Fat", data.bodyFat, { round: true, skipZero });

  if (isUpdate) {
    // Update existing page - only non-zero properties are included
    const pageId = existing.results[0].id;
    await notionRequest(apiKey, "PATCH", `/pages/${pageId}`, { properties });
  } else {
    // Create new page
    await notionRequest(apiKey, "POST", "/pages", {
      parent: { database_id: databaseId },
      properties,
    });
  }
}
