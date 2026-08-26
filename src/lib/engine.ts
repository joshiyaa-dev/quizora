import type { PlayerState, QStat, Question, QuestionBank, SessionResult } from './types';

export const WORLDS = [
  'web', 'js', 'python', 'data', 'math',
  'science', 'space', 'geo', 'history', 'gk',
] as const;

export const WORLD_META: Record<string, { name: string; icon: string }> = {
  web: { name: 'Web Basics', icon: '🌐' },
  js: { name: 'JavaScript', icon: '⚡' },
  python: { name: 'Python', icon: '🐍' },
  data: { name: 'Data & DB', icon: '🗄️' },
  math: { name: 'Math & Logic', icon: '🧮' },
  science: { name: 'Science', icon: '🔬' },
  space: { name: 'Space', icon: '🚀' },
  geo: { name: 'Geography', icon: '🗺️' },
  history: { name: 'History', icon: '🏛️' },
  gk: { name: 'General Knowledge', icon: '💡' },
};

export const QUESTIONS_PER_SESSION = 10;

/** XP required to REACH a level (level 1 starts at 0). Monotonic curve. */
export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  return Math.round(100 * Math.pow(level - 1, 1.5));
}

export function levelFromXp(xp: number): number {
  let level = 1;
  while (xpForLevel(level + 1) <= xp) level++;
  return level;
}

export function freshStat(): QStat {
  return { seen: 0, correct: 0, ease: 2.5, intervalDays: 0, lastWrong: false };
}

/**
 * Adaptive picker: prefers questions that are
 *  - due for review (SM-2-lite interval elapsed since "virtual last"),
 *  - previously wrong,
 *  - near the target difficulty of the current level.
 * Deterministic given (bank, stats, rng) — testable.
 */
export function pickSession(
  bank: QuestionBank,
  world: string,
  level: number,
  stats: Record<string, QStat>,
  rng: () => number = Math.random,
  count = QUESTIONS_PER_SESSION,
): number[] {
  const pool = bank[world] ?? [];
  const indices = pool.map((_, i) => i);
  const targetD = Math.min(5, Math.max(1, Math.ceil(level / 2)));

  const weightOf = (i: number): number => {
    const q = pool[i];
    const st = stats[`${world}:${i}`];
    let w = 1;
    if (!st) w += 3; // unseen first
    else {
      if (st.lastWrong) w += 4; // retrain mistakes
      if (st.intervalDays > 0 && st.seen > 0 && st.correct < st.seen) w += 2; // weak spots
    }
    w += 2 / (1 + Math.abs(q.d - targetD)); // difficulty match
    return w * (0.75 + 0.5 * rng());
  };

  return indices
    .map((i) => ({ i, w: weightOf(i) }))
    .sort((a, b) => b.w - a.w)
    .slice(0, Math.min(count, indices.length))
    .map((x) => x.i);
}

/** Score one answer: base by difficulty + speed bonus (0-1 fraction of time left). */
export function scoreAnswer(q: Question, timeLeftFraction: number): number {
  const base = 40 + q.d * 20; // d1=60 .. d5=140
  return Math.round(base * (1 + 0.5 * Math.max(0, Math.min(1, timeLeftFraction))));
}

/** SM-2-lite update after an answer. */
export function updateStat(st: QStat, wasCorrect: boolean): QStat {
  const next = { ...st };
  next.seen += 1;
  if (wasCorrect) {
    next.correct += 1;
    next.ease = Math.min(3.2, next.ease + 0.12);
    next.intervalDays = next.intervalDays === 0 ? 1 : Math.round(next.intervalDays * next.ease);
    next.lastWrong = false;
  } else {
    next.ease = Math.max(1.3, next.ease - 0.25);
    next.intervalDays = 0;
    next.lastWrong = true;
  }
  return next;
}

export function todayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

function yesterdayKey(): string {
  const y = new Date();
  y.setDate(y.getDate() - 1);
  return todayKey(y);
}

export function touchStreak(state: PlayerState, now = new Date()): PlayerState {
  const t = todayKey(now);
  if (state.lastPlayedISO === t) return state;
  state.streak = state.lastPlayedISO === yesterdayKey() ? state.streak + 1 : 1;
  state.lastPlayedISO = t;
  return state;
}

export const ACHIEVEMENTS: Array<{ id: string; name: string; desc: string; test: (s: PlayerState, r: SessionResult) => boolean }> = [
  { id: 'first-steps', name: 'First Steps', desc: 'Finish your first session', test: (_s, r) => r.total > 0 },
  { id: 'flawless', name: 'Flawless Mind', desc: 'Score 100% in a session', test: (_s, r) => r.total >= 5 && r.correct === r.total },
  { id: 'sharpshooter', name: 'Sharpshooter', desc: 'Score 500+ in one session', test: (_s, r) => r.score >= 500 },
  { id: 'streak-3', name: 'On Fire', desc: 'Play 3 days in a row', test: (s) => s.streak >= 3 },
  { id: 'streak-7', name: 'Unstoppable', desc: 'Play 7 days in a row', test: (s) => s.streak >= 7 },
  { id: 'veteran-25', name: 'Veteran', desc: 'Answer 250 questions lifetime', test: (s) => Object.values(s.qstats).reduce((a, q) => a + q.seen, 0) >= 250 },
  { id: 'master-90', name: 'Mastermind', desc: 'Reach level 10', test: (s) => levelFromXp(s.xp) >= 10 },
];

export function checkAchievements(state: PlayerState, result: SessionResult): string[] {
  return ACHIEVEMENTS.filter((a) => !state.achievements.includes(a.id) && a.test(state, result)).map((a) => a.id);
}

/** Finalize a finished session into the player state (mutates and returns it). */
export function applySession(
  state: PlayerState,
  world: string,
  answers: Array<{ index: number; question: Question; chosen: number | null; secondsUsed: number; secondsTotal: number }>,
): SessionResult {
  let score = 0;
  let correct = 0;
  for (const a of answers) {
    const wasCorrect = a.chosen === a.question.correct;
    if (wasCorrect) {
      correct += 1;
      score += scoreAnswer(a.question, 1 - a.secondsUsed / Math.max(1, a.secondsTotal));
    }
    const key = `${world}:${a.index}`;
    state.qstats[key] = updateStat(state.qstats[key] ?? freshStat(), wasCorrect);
  }

  const xpGained = score;
  const coinsGained = correct * 5 + (correct === answers.length ? 25 : 0);

  state.xp += xpGained;
  state.coins += coinsGained;
  if ((state.best[world] ?? 0) < score) state.best[world] = score;

  const dk = todayKey();
  const day = state.dailyLog[dk] ?? { sessions: 0, correct: 0, seen: 0 };
  day.sessions += 1;
  day.correct += correct;
  day.seen += answers.length;
  state.dailyLog[dk] = day;

  touchStreak(state);

  const result: SessionResult = {
    world, score, correct, total: answers.length,
    xpGained, coinsGained, newAchievements: [],
  };
  result.newAchievements = checkAchievements(state, result);
  state.achievements.push(...result.newAchievements);
  return result;
}
