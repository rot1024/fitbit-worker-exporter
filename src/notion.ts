import { Client } from "@notionhq/client";
import type { DailyData } from "../packages/fitbit/src/index.js";

export async function saveToNotion(
  apiKey: string,
  dataSourceId: string,
  data: DailyData
): Promise<void> {
  const notion = new Client({ auth: apiKey });

  // Check for existing entry with same date
  const existing = await notion.dataSources.query({
    data_source_id: dataSourceId,
    filter: {
      property: "Date",
      date: {
        equals: data.date,
      },
    },
  });

  const properties = {
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

  if (existing.results.length > 0) {
    // Update existing page
    const pageId = existing.results[0].id;
    await notion.pages.update({
      page_id: pageId,
      properties,
    });
  } else {
    // Create new page
    await notion.pages.create({
      parent: { database_id: dataSourceId },
      properties,
    });
  }
}
