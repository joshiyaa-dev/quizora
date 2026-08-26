import type { PlayerState } from './types';

const KEY = 'quizora_state_v1';

export function freshState(): PlayerState {
  return {
    xp: 0,
    coins: 0,
    gems: 0,
    streak: 0,
    lastPlayedISO: null,
    best: {},
    qstats: {},
    dailyLog: {},
    achievements: [],
  };
}

export function loadState(): PlayerState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return freshState();
    const parsed = JSON.parse(raw) as Partial<PlayerState>;
    return { ...freshState(), ...parsed };
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
