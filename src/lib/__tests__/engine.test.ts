import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENTS, accuracyByDifficulty, applySession, bossReady, checkAchievements,
  freshStat, grantPowerUp, heatmapDays, insertLeaderRow, levelFromXp,
  mulberry32, openMistakes, pickBoss, pickDaily, pickSession, recordMistake,
  scoreAnswer, themeUnlocked, touchStreak, updateStat, usePowerUp,
  WORLDS, worldStars, worldUnlocked, xpForLevel,
} from '../engine';
import type { PlayerState, Question, QuestionBank } from './types';

function makeBank(n = 12): QuestionBank {
  return {
    web: Array.from({ length: n }, (_, i) => ({
      q: `Q${i}`, options: ['a', 'b', 'c', 'd'], correct: i % 4,
      explain: 'x', d: ((i % 5) + 1) as Question['d'],
    })),
  };
}

const rng = () => 0.5;

const base = (): PlayerState => ({
  name: 'T', xp: 0, coins: 0, gems: 0, streak: 0, lastPlayedISO: null,
  best: {}, qstats: {}, dailyLog: {}, achievements: [],
  powerUps: { fifty: 0, freeze: 0, shield: 0 }, mistakes: [], leaderboard: [],
  flagged: [], theme: 'nebula', sound: true, dysFont: false, packs: [],
});

describe('xp curve', () => {
  it('is monotonic and starts at 0', () => {
    expect(xpForLevel(1)).toBe(0);
    for (let l = 2; l < 30; l++) expect(xpForLevel(l + 1)).toBeGreaterThan(xpForLevel(l));
  });
  it('levelFromXp inverts the curve', () => {
    expect(levelFromXp(0)).toBe(1);
    expect(levelFromXp(xpForLevel(5))).toBe(5);
    expect(levelFromXp(xpForLevel(10) - 1)).toBe(9);
  });
});

describe('adaptive picker', () => {
  it('returns requested count within bounds', () => {
    const bank = makeBank();
    const picks = pickSession(bank, 'web', 3, {}, rng, 10);
    expect(picks).toHaveLength(10);
    expect(new Set(picks).size).toBe(10);
  });
  it('prefers unseen questions for a new player', () => {
    const bank = makeBank();
    const picks = pickSession(bank, 'web', 3, {}, rng, 6);
    // all stats empty => unseen bonus equal; difficulty target level3 -> d2
    // d2 questions are indices where (i%5)+1==2 -> i=1,6,11 — they should rank high
    expect(picks.slice(0, 3)).toEqual(expect.arrayContaining([1, 6].slice(0, 2)));
  });
  it('boosts previously-wrong questions', () => {
    const bank = makeBank();
    const stats = { 'web:0': { ...freshStat(), lastWrong: true } };
    const picks = pickSession(bank, 'web', 9, stats, rng, 4);
    expect(picks).toContain(0);
  });
});

describe('scoring & SM-2-lite', () => {
  it('harder + faster scores more', () => {
    const easy: Question = { q: '', options: [], correct: 0, explain: '', d: 1 };
    const hard: Question = { q: '', options: [], correct: 0, explain: '', d: 5 };
    expect(scoreAnswer(hard, 1)).toBeGreaterThan(scoreAnswer(easy, 0));
  });
  it('correct answers grow interval, wrong resets it', () => {
    let st = freshStat();
    st = updateStat(st, true);
    expect(st.intervalDays).toBe(1);
    st = updateStat(st, true);
    expect(st.intervalDays).toBeGreaterThanOrEqual(2);
    st = updateStat(st, false);
    expect(st.intervalDays).toBe(0);
    expect(st.lastWrong).toBe(true);
  });
});

describe('streaks', () => {
  it('continues streak on consecutive days', () => {
    const s: PlayerState = { ...({} as PlayerState), streak: 2, lastPlayedISO: new Date(Date.now() - 86400000).toISOString().slice(0, 10) };
    touchStreak(s);
    expect(s.streak).toBe(3);
  });
  it('resets streak after a gap', () => {
    const s: PlayerState = { ...({} as PlayerState), streak: 5, lastPlayedISO: '2020-01-01' };
    touchStreak(s);
    expect(s.streak).toBe(1);
  });
  it('same-day replay does not double-count', () => {
    const t = new Date().toISOString().slice(0, 10);
    const s: PlayerState = { ...({} as PlayerState), streak: 4, lastPlayedISO: t };
    touchStreak(s);
    expect(s.streak).toBe(4);
  });
});

describe('session application', () => {
  const bank = makeBank();
  it('awards xp/coins and records stats', () => {
    const state = base();
    const picks = pickSession(bank, 'web', 3, state.qstats, rng, 5);
    const answers = picks.map((index) => ({
      index, question: bank.web[index], chosen: bank.web[index].correct,
      secondsUsed: 2, secondsTotal: 20,
    }));
    const r = applySession(state, 'web', answers);
    expect(r.correct).toBe(5);
    expect(r.xpGained).toBeGreaterThan(0);
    expect(state.coins).toBe(r.coinsGained);
    expect(Object.keys(state.qstats)).toHaveLength(5);
    expect(state.achievements).toContain('first-steps');
    expect(state.achievements).toContain('flawless');
  });
  it('never re-awards an achievement', () => {
    const state = base();
    state.achievements = ['first-steps'];
    const answers = [{
      index: 0, question: bank.web[0], chosen: null as number | null,
      secondsUsed: 10, secondsTotal: 20,
    }];
    const r = applySession(state, 'web', answers);
    expect(r.newAchievements).toHaveLength(0);
  });
  it('achievement catalog has unique ids', () => {
    expect(new Set(ACHIEVEMENTS.map((a) => a.id)).size).toBe(ACHIEVEMENTS.length);
  });
});

/* ================= v2 features ================= */

describe('daily challenge & rng', () => {
  it('mulberry32 is deterministic per seed', () => {
    const a = mulberry32(42), b = mulberry32(42), c = mulberry32(43);
    expect([a(), a()]).toEqual([b(), b()]);
    expect(a()).not.toEqual(c());
  });
  it('same seed yields same daily set', () => {
    const bank = makeBank(25);
    bank.js = bank.web;
    const x = pickDaily(bank, 10, 777).map((p) => `${p.world}:${p.index}`);
    const y = pickDaily(bank, 10, 777).map((p) => `${p.world}:${p.index}`);
    const z = pickDaily(bank, 10, 778).map((p) => `${p.world}:${p.index}`);
    expect(x).toEqual(y);
    expect(x).not.toEqual(z);
  });
});

describe('boss battles & world progression', () => {
  it('pickBoss prefers hardest least-seen questions', () => {
    const bank = makeBank();
    const stats = { 'web:0': { ...freshStat(), seen: 9 } };
    const boss = pickBoss(bank, 'web', stats, 3);
    expect(boss).not.toContain(0); // most-seen question deprioritized
    expect(boss).toHaveLength(3);
  });
  it('world 1 open, later worlds locked until progress', () => {
    const s = base();
    expect(worldUnlocked(0, s)).toBe(true);
    expect(worldUnlocked(1, s)).toBe(false);
  });
  it('stars need accuracy thresholds and volume', () => {
    const s = base();
    expect(worldStars('web', s)).toBe(0); // <10 answers
    for (let i = 0; i < 12; i++) s.qstats[`web:${i}`] = { ...freshStat(), seen: 1, correct: 1 };
    expect(worldStars('web', s)).toBe(3); // 100%
  });
  it('boss unlocks at 80% world coverage', () => {
    const s = base();
    const bank = makeBank(); // 12 questions
    for (let i = 0; i < 9; i++) s.qstats[`web:${i}`] = { ...freshStat(), seen: 1 };
    expect(bossReady('web', s, bank)).toBe(false);
    s.qstats['web:9'] = { ...freshStat(), seen: 1 };
    expect(bossReady('web', s, bank)).toBe(true);
  });
});

describe('power-ups', () => {
  it('grant requires level 2+, use decrements', () => {
    const s = base(); // level 1
    expect(grantPowerUp(s, () => 0)).toBeNull();
    s.xp = xpForLevel(2);
    const kind = grantPowerUp(s, () => 0)!;
    expect(s.powerUps[kind]).toBe(1);
    expect(usePowerUp(s, kind)).toBe(true);
    expect(s.powerUps[kind]).toBe(0);
    expect(usePowerUp(s, kind)).toBe(false);
  });
});

describe('mistakes notebook', () => {
  it('records unreviewed mistakes once, clears on review', () => {
    const s = base();
    recordMistake(s, 'web', 3, 'w3');
    recordMistake(s, 'web', 3, 'w3'); // duplicate while open
    expect(openMistakes(s)).toHaveLength(1);
    s.mistakes[0].reviewedAt = Date.now();
    expect(openMistakes(s)).toHaveLength(0);
  });
});

describe('leaderboard & analytics', () => {
  it('keeps top-10 sorted desc', () => {
    const s = base();
    for (let i = 1; i <= 12; i++) insertLeaderRow(s, { score: i * 10, label: 'w', date: 'x' });
    expect(s.leaderboard).toHaveLength(10);
    expect(s.leaderboard[0].score).toBe(120);
    expect(s.leaderboard[9].score).toBe(30);
  });
  it('accuracyByDifficulty aggregates per level', () => {
    const s = base();
    s.qstats['web:0'] = { ...freshStat(), seen: 2, correct: 1 }; // d=1
    const rows = accuracyByDifficulty(s, makeBank());
    expect(rows[0]).toEqual({ d: 1, seen: 2, pct: 50 });
    expect(rows[4].seen).toBe(0);
  });
  it('heatmap covers n days ending today', () => {
    const days = heatmapDays(base(), 14);
    expect(days).toHaveLength(14);
    expect(days[13].key).toBe(new Date().toISOString().slice(0, 10));
  });
  it('themes gate by level', () => {
    const s = base();
    expect(themeUnlocked('nebula', s)).toBe(true);
    expect(themeUnlocked('inferno', s)).toBe(false);
    s.xp = xpForLevel(8);
    expect(themeUnlocked('inferno', s)).toBe(true);
    expect(WORLDS.length).toBe(10);
  });
});

describe('bank integrity', () => {
  it('has 10 worlds x 25 valid questions', async () => {
    const mod = await import('../../data/questions.json');
    const bank = mod.default as unknown as QuestionBank;
    expect(WORLDS.every((w) => bank[w]?.length === 25)).toBe(true);
    for (const w of WORLDS) {
      for (const q of bank[w]) {
        expect(q.options).toHaveLength(4);
        expect(q.correct).toBeGreaterThanOrEqual(0);
        expect(q.correct).toBeLessThan(4);
        expect(q.d).toBeGreaterThanOrEqual(1);
        expect(q.d).toBeLessThanOrEqual(5);
      }
    }
  });
});
