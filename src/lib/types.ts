export type Difficulty = 1 | 2 | 3 | 4 | 5;

export interface Question {
  q: string;
  options: string[];
  correct: number;
  explain: string;
  d: Difficulty;
}

export type QuestionBank = Record<string, Question[]>;

export interface QStat {
  seen: number;
  correct: number;
  ease: number; // SM-2-lite factor, default 2.5
  intervalDays: number;
  lastWrong: boolean;
}

export interface PlayerState {
  xp: number;
  coins: number;
  gems: number;
  streak: number;
  lastPlayedISO: string | null;
  best: Record<string, number>; // world -> best session score
  qstats: Record<string, QStat>; // `${world}:${index}` -> stat
  dailyLog: Record<string, { sessions: number; correct: number; seen: number }>;
  achievements: string[];
}

export interface SessionResult {
  world: string;
  score: number;
  correct: number;
  total: number;
  xpGained: number;
  coinsGained: number;
  newAchievements: string[];
}
