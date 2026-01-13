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

  const properties: Record<string, unknown> = {
    Date: {
      date: {
        start: data.date,
      },
    },
    Calories: {
      number: data.calories,
    },
    Steps: {
      number: data.steps,
    },
    Distance: {
      number: Math.round(data.distance * 100) / 100,
    },
    "Sleep Duration": {
      number: data.sleepDuration,
    },
    "Sleep Efficiency": {
      number: data.sleepEfficiency,
    },
    "Deep Sleep": {
      number: data.deepSleep,
    },
    "Light Sleep": {
      number: data.lightSleep,
    },
    "REM Sleep": {
      number: data.remSleep,
    },
    Awake: {
      number: data.awake,
    },
  };

  if (data.weight !== undefined) {
    properties.Weight = { number: Math.round(data.weight * 100) / 100 };
  }
  if (data.bmi !== undefined) {
    properties.BMI = { number: Math.round(data.bmi * 100) / 100 };
  }
  if (data.bodyFat !== undefined) {
    properties["Body Fat"] = { number: Math.round(data.bodyFat * 100) / 100 };
  }

  if (existing.results.length > 0) {
    // Update existing page
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
