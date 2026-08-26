import './style.css';
import bank from './data/questions.json';
import {
  ACHIEVEMENTS, applySession, levelFromXp, pickSession, QUESTIONS_PER_SESSION,
  scoreAnswer, WORLDS, WORLD_META, xpForLevel,
} from './lib/engine';
import { loadState, resetState, saveState } from './lib/store';
import type { PlayerState, Question } from './lib/types';

type Screen = 'home' | 'game' | 'results' | 'profile';

const app = document.getElementById('app')!;
let state: PlayerState = loadState();
let screen: Screen = 'home';

// session-in-progress
let sWorld = '';
let sPicks: number[] = [];
let sIdx = 0;
let sAnswers: Array<{ index: number; question: Question; chosen: number | null; secondsUsed: number; secondsTotal: number }> = [];
let sTimer: ReturnType<typeof setInterval> | null = null;
let sTimeLeft = 20;
const TIME_PER_Q = 20;
let lastResult: ReturnType<typeof applySession> | null = null;
let newBadgeIds: string[] = [];

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

function render(): void {
  if (sTimer && screen !== 'game') { clearInterval(sTimer); sTimer = null; }
  const topbar = `
    <div class="topbar">
      <div class="brand" data-nav="home">🛸 QUIZORA</div>
      <div class="pills">
        <span class="pill">⭐ Lv ${levelFromXp(state.xp)}</span>
        <span class="pill">✨ ${state.xp} XP</span>
        <span class="pill">🪙 ${state.coins}</span>
        <span class="pill">🔥 ${state.streak}d</span>
        <button class="pill" style="cursor:pointer" data-nav="profile">🏅 ${state.achievements.length}/${ACHIEVEMENTS.length}</button>
      </div>
    </div>`;

  let body = '';
  if (screen === 'home') body = renderHome();
  else if (screen === 'game') body = renderGame();
  else if (screen === 'results') body = renderResults();
  else if (screen === 'profile') body = renderProfile();

  app.innerHTML = topbar + body;

  // wire events
  app.querySelectorAll('[data-nav]').forEach((el) =>
    el.addEventListener('click', () => { screen = (el as HTMLElement).dataset.nav as Screen; render(); }));
  app.querySelectorAll('[data-world]').forEach((el) =>
    el.addEventListener('click', () => startSession((el as HTMLElement).dataset.world!)));
  app.querySelectorAll('[data-opt]').forEach((el) =>
    el.addEventListener('click', () => answer(Number((el as HTMLElement).dataset.opt))));
  app.querySelectorAll('[data-next]').forEach((el) =>
    el.addEventListener('click', nextQuestion));
  const replay = document.querySelector('[data-replay]');
  replay?.addEventListener('click', () => startSession(sWorld));
  document.querySelector('[data-reset]')?.addEventListener('click', () => {
    if (confirm('Reset ALL progress? This cannot be undone.')) { state = resetState(); render(); }
  });
}

function worldProgress(w: string): { pct: number; seen: number } {
  const seen = Object.keys(state.qstats).filter((k) => k.startsWith(`${w}:`)).length;
  return { pct: Math.round((seen / 25) * 100), seen };
}

function renderHome(): string {
  const cards = WORLDS.map((w) => {
    const meta = WORLD_META[w];
    const p = worldProgress(w);
    return `
      <div class="world-card fadein" data-world="${w}">
        <div class="row1"><span class="emoji">${meta.icon}</span><span class="name">${meta.name}</span></div>
        <div class="meta"><span>${p.seen}/25 explored</span><span>best ${state.best[w] ?? 0}</span></div>
        <div class="bar"><i style="width:${p.pct}%"></i></div>
      </div>`;
  }).join('');
  return `<h2 class="section">Choose your world</h2><div class="worlds">${cards}</div>`;
}

function startSession(world: string): void {
  sWorld = world;
  sPicks = pickSession(bank as never, world, levelFromXp(state.xp), state.qstats);
  sIdx = 0;
  sAnswers = [];
  screen = 'game';
  armTimer();
  render();
}

function armTimer(): void {
  if (sTimer) clearInterval(sTimer);
  sTimeLeft = TIME_PER_Q;
  sTimer = setInterval(() => {
    sTimeLeft -= 1;
    const bar = document.querySelector('.timerbar > i') as HTMLElement | null;
    if (bar) bar.style.width = `${(sTimeLeft / TIME_PER_Q) * 100}%`;
    if (sTimeLeft <= 0) answer(-1); // timeout = no answer
  }, 1000);
}

function currentQuestion(): Question {
  return (bank as Record<string, Question[]>)[sWorld][sPicks[sIdx]];
}

function renderGame(): string {
  const q = currentQuestion();
  const letters = ['A', 'B', 'C', 'D'];
  const opts = q.options.map((o, i) => `<button class="opt" data-opt="${i}"><b>${letters[i]}.</b> ${esc(o)}</button>`).join('');
  return `
    <div class="card fadein">
      <div class="qhead">
        <span>${WORLD_META[sWorld].icon} ${WORLD_META[sWorld].name} · Q${sIdx + 1}/${QUESTIONS_PER_SESSION}</span>
        <span class="diffdots">${'●'.repeat(q.d)}<span class="muted">${'●'.repeat(5 - q.d)}</span></span>
      </div>
      <div class="timerbar"><i style="width:${(sTimeLeft / TIME_PER_Q) * 100}%"></i></div>
      <div class="question">${esc(q.q)}</div>
      <div class="options">${opts}</div>
      <div id="feedback"></div>
    </div>`;
}

function answer(chosen: number): void {
  if (sTimer) { clearInterval(sTimer); sTimer = null; }
  const q = currentQuestion();
  const wasCorrect = chosen === q.correct;
  sAnswers.push({ index: sPicks[sIdx], question: q, chosen, secondsUsed: TIME_PER_Q - sTimeLeft, secondsTotal: TIME_PER_Q });

  document.querySelectorAll<HTMLButtonElement>('.opt').forEach((b, i) => {
    b.disabled = true;
    if (i === q.correct) b.classList.add('correct');
    else if (i === chosen) b.classList.add('wrong');
  });
  const previewScore = wasCorrect ? scoreAnswer(q, Math.max(0, sTimeLeft / TIME_PER_Q)) : 0;
  const fb = document.getElementById('feedback')!;
  fb.innerHTML = `
    <div class="explain">${wasCorrect ? `✅ Correct! +${previewScore} pts` : `❌ Not quite — answer marked in green.`}<br/>${esc(q.explain)}</div>
    <button class="primary" data-next>${sIdx + 1 >= QUESTIONS_PER_SESSION ? 'See results →' : 'Next question →'}</button>`;
  fb.querySelector('[data-next]')?.addEventListener('click', nextQuestion);
}

function nextQuestion(): void {
  sIdx += 1;
  if (sIdx >= QUESTIONS_PER_SESSION || sIdx >= sPicks.length) finishSession();
  else { armTimer(); render(); }
}

function finishSession(): void {
  lastResult = applySession(state, sWorld, sAnswers);
  newBadgeIds = lastResult.newAchievements;
  saveState(state);
  screen = 'results';
  render();
}

function ring(pct: number): string {
  const r = 42, c = 2 * Math.PI * r;
  const off = c * (1 - pct / 100);
  return `
    <svg width="110" height="110" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="${r}" fill="none" stroke="rgba(255,255,255,.08)" stroke-width="10"/>
      <circle cx="50" cy="50" r="${r}" fill="none" stroke="#00d4ff" stroke-width="10"
        stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${off}" transform="rotate(-90 50 50)"/>
      <text x="50" y="57" text-anchor="middle" font-size="18" font-weight="800" fill="#eef1ff">${pct}%</text>
    </svg>`;
}

function renderResults(): string {
  if (!lastResult) { screen = 'home'; return renderHome(); }
  const pct = Math.round((lastResult.correct / Math.max(1, lastResult.total)) * 100);
  const badges = ACHIEVEMENTS.map((a) => {
    const has = state.achievements.includes(a.id);
    const isNew = newBadgeIds.includes(a.id);
    return `<div class="badge ${has ? '' : 'locked'} ${isNew ? 'newbadge' : ''}">${has ? '🏅' : '🔒'}<b>${a.name}</b><span class="muted">${a.desc}</span></div>`;
  }).join('');
  return `
    <div class="card fadein center">
      <h2 style="margin-bottom:4px">${WORLD_META[sWorld].icon} ${WORLD_META[sWorld].name}</h2>
      <p class="muted">Session complete</p>
      <div class="ringwrap" style="justify-content:center">${ring(pct)}
        <div style="text-align:left">
          <div><b style="font-size:26px">${lastResult.score}</b> <span class="muted">pts</span></div>
          <div class="muted">✨ +${lastResult.xpGained} XP · 🪙 +${lastResult.coinsGained}</div>
          <div class="muted">Level ${levelFromXp(state.xp)} · next at ${xpForLevel(levelFromXp(state.xp) + 1)} XP</div>
        </div>
      </div>
      <button class="primary" data-replay>Play again</button>
      <button class="ghost" data-nav="home">← Back to worlds</button>
    </div>
    <h2 class="section">Achievements</h2>
    <div class="badges">${badges}</div>`;
}

function renderProfile(): string {
  const lifetimeSeen = Object.values(state.qstats).reduce((a, q) => a + q.seen, 0);
  const lifetimeCorrect = Object.values(state.qstats).reduce((a, q) => a + q.correct, 0);
  const acc = lifetimeSeen ? Math.round((lifetimeCorrect / lifetimeSeen) * 100) : 0;
  const lv = levelFromXp(state.xp);
  const cur = state.xp - xpForLevel(lv);
  const need = xpForLevel(lv + 1) - xpForLevel(lv);
  const badges = ACHIEVEMENTS.map((a) => {
    const has = state.achievements.includes(a.id);
    return `<div class="badge ${has ? '' : 'locked'}">🏅<b>${a.name}</b><span class="muted">${a.desc}</span></div>`;
  }).join('');
  return `
    <div class="card fadein">
      <h2 style="margin-bottom:12px">Commander profile</h2>
      <div class="stats-grid">
        <div class="statbox"><b>${lv}</b><span>level</span></div>
        <div class="statbox"><b>${state.xp}</b><span>xp</span></div>
        <div class="statbox"><b>${acc}%</b><span>accuracy</span></div>
        <div class="statbox"><b>${lifetimeSeen}</b><span>answered</span></div>
        <div class="statbox"><b>🔥 ${state.streak}</b><span>day streak</span></div>
        <div class="statbox"><b>${Math.min(99, Math.round((cur / Math.max(1, need)) * 100))}%</b><span>to lv ${lv + 1}</span></div>
      </div>
      <h2 class="section">Achievements</h2>
      <div class="badges">${badges}</div>
      <button class="ghost" data-reset>Danger zone — reset all progress</button>
    </div>`;
}

render();
