// OAuth Types
export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
  user_id: string;
}

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  userId: string;
}

// Activity Types
export interface ActivitySummary {
  caloriesOut: number;
  steps: number;
  distances: Distance[];
  activeScore: number;
  activityCalories: number;
  caloriesBMR: number;
  marginalCalories: number;
  sedentaryMinutes: number;
  lightlyActiveMinutes: number;
  fairlyActiveMinutes: number;
  veryActiveMinutes: number;
  restingHeartRate?: number;
}

export interface Distance {
  activity: string;
  distance: number;
}

export interface ActivityResponse {
  summary: ActivitySummary;
}

// Sleep Types
export interface SleepSummary {
  totalMinutesAsleep: number;
  totalSleepRecords: number;
  totalTimeInBed: number;
  stages?: SleepStages;
}

export interface SleepStages {
  deep: number;
  light: number;
  rem: number;
  wake: number;
}

export interface SleepLog {
  dateOfSleep: string;
  duration: number;
  efficiency: number;
  isMainSleep: boolean;
  minutesAsleep: number;
  minutesAwake: number;
  startTime: string;
  endTime: string;
  levels?: {
    summary: {
      deep?: { minutes: number };
      light?: { minutes: number };
      rem?: { minutes: number };
      wake?: { minutes: number };
    };
  };
}

export interface SleepResponse {
  sleep: SleepLog[];
  summary: SleepSummary;
}

// Combined daily data
export interface DailyData {
  date: string;
  calories: number;
  steps: number;
  distance: number;
  sleepDuration: number;
  sleepEfficiency: number;
  deepSleep: number;
  lightSleep: number;
  remSleep: number;
  awake: number;
}

// OAuth Config
export interface FitbitOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}
