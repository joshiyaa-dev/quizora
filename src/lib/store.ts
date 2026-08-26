import type { PlayerState } from './types';

const KEY = 'quizora_state_v1';

export function freshState(): PlayerState {
  return {
    name: 'Explorer',
    xp: 0,
    coins: 0,
    gems: 0,
    streak: 0,
    lastPlayedISO: null,
    best: {},
    qstats: {},
    dailyLog: {},
    achievements: [],
    powerUps: { fifty: 1, freeze: 0, shield: 0 },
    mistakes: [],
    leaderboard: [],
    flagged: [],
    theme: 'nebula',
    sound: true,
    dysFont: false,
    packs: [],
  };
}

export function loadState(): PlayerState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return freshState();
    const parsed = JSON.parse(raw) as Partial<PlayerState>;
    return {
      ...freshState(),
      ...parsed,
      powerUps: { ...freshState().powerUps, ...(parsed.powerUps ?? {}) },
    };
  } catch {
    return freshState();
  }
}

export function saveState(state: PlayerState): void {
  localStorage.setItem(KEY, JSON.stringify(state));
}

export function resetState(): PlayerState {
  const s = freshState();
  saveState(s);
  return s;
}
