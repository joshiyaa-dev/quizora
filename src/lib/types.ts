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

export type PowerUpKind = 'fifty' | 'freeze' | 'shield';

export interface MistakeEntry {
  world: string;
  index: number;
  qid: string;
  ts: number;
  reviewedAt?: number;
}

export interface LeaderRow {
  score: number;
  label: string;
  date: string;
}

export interface PlayerState {
  name: string;
  xp: number;
  coins: number;
  gems: number;
  streak: number;
  lastPlayedISO: string | null;
  best: Record<string, number>; // world -> best session score
  qstats: Record<string, QStat>; // `${world}:${index}` -> stat
  dailyLog: Record<string, { sessions: number; correct: number; seen: number }>;
  achievements: string[];
  // v2 additions
  powerUps: Record<PowerUpKind, number>;
  mistakes: MistakeEntry[];
  leaderboard: LeaderRow[];
  flagged: string[];
  theme: string;
  sound: boolean;
  dysFont: boolean;
  packs: string[]; // names of imported custom packs merged into bank
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
