import type {
  FitbitOAuthConfig,
  StoredTokens,
  ActivityResponse,
  SleepResponse,
  WeightResponse,
  DailyData,
} from "./types.js";
import { refreshToken, isTokenExpired } from "./oauth.js";

const API_BASE = "https://api.fitbit.com";

export interface TokenStorage {
  get(): Promise<StoredTokens | null>;
  set(tokens: StoredTokens): Promise<void>;
}

export class FitbitClient {
  private config: FitbitOAuthConfig;
  private storage: TokenStorage;

  constructor(config: FitbitOAuthConfig, storage: TokenStorage) {
    this.config = config;
    this.storage = storage;
  }

  private async getValidToken(): Promise<string> {
    const tokens = await this.storage.get();
    if (!tokens) {
      throw new Error("No tokens found. Please authenticate first.");
    }

    if (isTokenExpired(tokens)) {
      const newTokens = await refreshToken(this.config, tokens.refreshToken);
      await this.storage.set(newTokens);
      return newTokens.accessToken;
    }

    return tokens.accessToken;
  }

  private async request<T>(path: string): Promise<T> {
    const accessToken = await this.getValidToken();
    const response = await fetch(`${API_BASE}${path}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Fitbit API error: ${response.status} ${error}`);
    }

    return response.json() as Promise<T>;
  }

  async getActivity(date: string): Promise<ActivityResponse> {
    return this.request<ActivityResponse>(
      `/1/user/-/activities/date/${date}.json`
    );
  }

  async getSleep(date: string): Promise<SleepResponse> {
    return this.request<SleepResponse>(
      `/1.2/user/-/sleep/date/${date}.json`
    );
  }

  async getWeight(date: string): Promise<WeightResponse> {
    return this.request<WeightResponse>(
      `/1/user/-/body/log/weight/date/${date}.json`
    );
  }

  async getDailyData(date: string): Promise<DailyData> {
    const [activity, sleep, weightData] = await Promise.all([
      this.getActivity(date),
      this.getSleep(date),
      this.getWeight(date),
    ]);

    const totalDistance = activity.summary.distances.find(
      (d) => d.activity === "total"
    );

    const mainSleep = sleep.sleep.find((s) => s.isMainSleep) ?? sleep.sleep[0];
    const sleepStages = mainSleep?.levels?.summary;

    // Use the latest weight measurement of the day
    const latestWeight =
      weightData.weight.length > 0
        ? weightData.weight[weightData.weight.length - 1]
        : null;

    return {
      date,
      calories: activity.summary.caloriesOut,
      steps: activity.summary.steps,
      distance: totalDistance?.distance ?? 0,
      sleepDuration: mainSleep?.minutesAsleep ?? 0,
      sleepEfficiency: mainSleep?.efficiency ?? 0,
      deepSleep: sleepStages?.deep?.minutes ?? 0,
      lightSleep: sleepStages?.light?.minutes ?? 0,
      remSleep: sleepStages?.rem?.minutes ?? 0,
      awake: sleepStages?.wake?.minutes ?? 0,
      weight: latestWeight?.weight,
      bmi: latestWeight?.bmi,
      bodyFat: latestWeight?.fat,
    };
  }
}
