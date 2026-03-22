export interface BusinessHours {
  timezone: string;
  days: number[];
  start: string;
  end: string;
}

export interface HandoffRules {
  maxFailedTurns: number;
  stockFreshnessMinutes: number;
  negativeSentimentEscalation: boolean;
}
