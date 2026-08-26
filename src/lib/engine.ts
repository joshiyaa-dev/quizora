import type { LeaderRow, MistakeEntry, PlayerState, PowerUpKind, QStat, Question, QuestionBank, SessionResult } from './types';

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

export const ACHIEVEMENTS: Array<{ id: string; name: string; desc: string; rarity: 'common' | 'rare' | 'epic' | 'legendary'; test: (s: PlayerState, r: SessionResult) => boolean }> = [
  { id: 'first-steps', name: 'First Steps', desc: 'Finish your first session', rarity: 'common', test: (_s, r) => r.total > 0 },
  { id: 'flawless', name: 'Flawless Mind', desc: 'Score 100% in a session', rarity: 'rare', test: (_s, r) => r.total >= 5 && r.correct === r.total },
  { id: 'sharpshooter', name: 'Sharpshooter', desc: 'Score 500+ in one session', rarity: 'rare', test: (_s, r) => r.score >= 500 },
  { id: 'streak-3', name: 'On Fire', desc: 'Play 3 days in a row', rarity: 'common', test: (s) => s.streak >= 3 },
  { id: 'streak-7', name: 'Unstoppable', desc: 'Play 7 days in a row', rarity: 'epic', test: (s) => s.streak >= 7 },
  { id: 'veteran-25', name: 'Veteran', desc: 'Answer 250 questions lifetime', rarity: 'rare', test: (s) => Object.values(s.qstats).reduce((a, q) => a + q.seen, 0) >= 250 },
  { id: 'master-90', name: 'Mastermind', desc: 'Reach level 10', rarity: 'epic', test: (s) => levelFromXp(s.xp) >= 10 },
  { id: 'boss-slayer', name: 'Boss Slayer', desc: 'Defeat any world boss', rarity: 'epic', test: () => false }, // granted manually
  { id: 'survivor-10', name: 'Survivor', desc: 'Survive 10 questions in Endless mode', rarity: 'rare', test: () => false },
  { id: 'duel-champ', name: 'Duel Champion', desc: 'Win a hot-seat duel', rarity: 'common', test: () => false },
  { id: 'blitz-ace', name: 'Blitz Ace', desc: 'Score 400+ in one Blitz run', rarity: 'epic', test: () => false },
  { id: 'collector', name: 'Pack Collector', desc: 'Import a question pack', rarity: 'legendary', test: () => false },
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

/* ================= v2: modes, power-ups, analytics ================= */

/** Deterministic PRNG (mulberry32) for daily challenges. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function dateSeed(d = new Date()): number {
  return Number(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`);
}

/** Same N questions for everyone on a given day. */
export function pickDaily(bank: QuestionBank, n = QUESTIONS_PER_SESSION, seed = dateSeed()): Array<{ world: string; index: number; q: Question }> {
  const all: Array<{ world: string; index: number; q: Question }> = [];
  for (const w of WORLDS) (bank[w] ?? []).forEach((q, i) => all.push({ world: w, index: i, q }));
  const rng = mulberry32(seed);
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, Math.min(n, all.length));
}

/** Boss battle: the hardest unseen/least-seen questions of a world. */
export function pickBoss(bank: QuestionBank, world: string, stats: Record<string, QStat>, count = 5): number[] {
  const pool = bank[world] ?? [];
  return pool
    .map((q, i) => ({ i, score: q.d * 100 - (stats[`${world}:${i}`]?.seen ?? 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map((x) => x.i);
}

export type WorldStatus = 'locked' | 'open' | 'boss-ready';

/** Worlds unlock in order: previous world needs ≥60% accuracy over ≥12 seen. */
export function worldUnlocked(worldIndex: number, state: PlayerState): boolean {
  if (worldIndex === 0) return true;
  const prev = WORLDS[worldIndex - 1];
  let seen = 0, correct = 0;
  for (const [k, st] of Object.entries(state.qstats)) {
    if (k.startsWith(`${prev}:`)) { seen += st.seen; correct += st.correct; }
  }
  return seen >= 12 && correct / Math.max(1, seen) >= 0.6;
}

/** Stars per world from lifetime accuracy there (needs ≥10 answers). */
export function worldStars(world: string, state: PlayerState): 0 | 1 | 2 | 3 {
  let seen = 0, correct = 0;
  for (const [k, st] of Object.entries(state.qstats)) {
    if (k.startsWith(`${world}:`)) { seen += st.seen; correct += st.correct; }
  }
  if (seen < 10) return 0;
  const pct = (correct / seen) * 100;
  return pct >= 90 ? 3 : pct >= 70 ? 2 : 1;
}

export function bossReady(world: string, state: PlayerState, bank: QuestionBank): boolean {
  const pool = bank[world] ?? [];
  const answered = pool.filter((_, i) => state.qstats[`${world}:${i}`]?.seen).length;
  return pool.length > 0 && answered >= Math.ceil(pool.length * 0.8);
}

/* ---- power-ups ---- */

export const POWERUP_META: Record<PowerUpKind, { name: string; icon: string; desc: string }> = {
  fifty: { name: '50 / 50', icon: '✂️', desc: 'Remove two wrong options' },
  freeze: { name: 'Time Freeze', icon: '❄️', desc: 'Pause the timer this question' },
  shield: { name: 'Shield', icon: '🛡️', desc: 'Survive one miss in Endless/Boss' },
};

const POWERUP_POOL: PowerUpKind[] = ['fifty', 'fifty', 'freeze', 'freeze', 'shield'];

/** Grant a random power-up (used on level-up). Returns granted kind or null. */
export function grantPowerUp(state: PlayerState, rng: () => number = Math.random): PowerUpKind | null {
  if (levelFromXp(state.xp) < 2) return null;
  const kind = POWERUP_POOL[Math.floor(rng() * POWERUP_POOL.length)];
  state.powerUps[kind] += 1;
  return kind;
}

export function usePowerUp(state: PlayerState, kind: PowerUpKind): boolean {
  if (state.powerUps[kind] <= 0) return false;
  state.powerUps[kind] -= 1;
  return true;
}

/* ---- mistakes notebook ---- */

export function recordMistake(state: PlayerState, world: string, index: number, qid: string): void {
  if (!state.mistakes.some((m) => m.world === world && m.index === index && !m.reviewedAt)) {
    state.mistakes.unshift({ world, index, qid, ts: Date.now() });
  }
  if (state.mistakes.length > 100) state.mistakes.length = 100;
}

export function openMistakes(state: PlayerState): MistakeEntry[] {
  return state.mistakes.filter((m) => !m.reviewedAt);
}

/* ---- leaderboard ---- */

export function insertLeaderRow(state: PlayerState, row: LeaderRow): void {
  state.leaderboard.push(row);
  state.leaderboard.sort((a, b) => b.score - a.score);
  if (state.leaderboard.length > 10) state.leaderboard.length = 10;
}

/* ---- analytics ---- */

export function accuracyByDifficulty(state: PlayerState, bank: QuestionBank): Array<{ d: number; seen: number; pct: number }> {
  const acc: Record<number, { seen: number; correct: number }> = {};
  for (const w of WORLDS) {
    (bank[w] ?? []).forEach((q, i) => {
      const st = state.qstats[`${w}:${i}`];
      if (!st?.seen) return;
      acc[q.d] ??= { seen: 0, correct: 0 };
      acc[q.d].seen += st.seen;
      acc[q.d].correct += st.correct;
    });
  }
  return [1, 2, 3, 4, 5].map((d) => ({
    d,
    seen: acc[d]?.seen ?? 0,
    pct: acc[d]?.seen ? Math.round((acc[d].correct / acc[d].seen) * 100) : 0,
  }));
}

/** Last N days heatmap data: sessions played per day. */
export function heatmapDays(state: PlayerState, n = 14): Array<{ key: string; sessions: number }> {
  const out: Array<{ key: string; sessions: number }> = [];
  for (let i = n - 1; i >= 0; i--) {
    const dt = new Date();
    dt.setDate(dt.getDate() - i);
    const k = todayKey(dt);
    out.push({ key: k, sessions: state.dailyLog[k]?.sessions ?? 0 });
  }
  return out;
}

/* ---- themes (unlock by level) ---- */

export const THEMES: Array<{ id: string; name: string; minLevel: number }> = [
  { id: 'nebula', name: 'Nebula', minLevel: 1 },
  { id: 'aurora', name: 'Aurora', minLevel: 4 },
  { id: 'inferno', name: 'Inferno', minLevel: 8 },
];

export function themeUnlocked(themeId: string, state: PlayerState): boolean {
  const t = THEMES.find((x) => x.id === themeId);
  return !!t && levelFromXp(state.xp) >= t.minLevel;
}
