import './style.css';
import rawBank from './data/questions.json';
import {
  ACHIEVEMENTS, accuracyByDifficulty, applySession, bossReady, grantPowerUp,
  heatmapDays, insertLeaderRow, levelFromXp, mulberry32, openMistakes,
  pickBoss, pickDaily, pickSession, POWERUP_META, QUESTIONS_PER_SESSION,
  recordMistake, scoreAnswer, THEMES, themeUnlocked, todayKey,
  touchStreak, usePowerUp, WORLDS, WORLD_META, worldStars, worldUnlocked,
  xpForLevel,
} from './lib/engine';
import { loadState, resetState, saveState } from './lib/store';
import type { PlayerState, PowerUpKind, Question, QuestionBank } from './lib/types';

const bank = rawBank as unknown as QuestionBank;

type Screen = 'home' | 'game' | 'results' | 'profile' | 'leaders' | 'notebook' | 'settings';
type ModeKind = 'world' | 'boss' | 'daily' | 'blitz' | 'duel' | 'survival';

const app = document.getElementById('app')!;
let state: PlayerState = loadState();
let screen: Screen = 'home';

interface QRef { world: string; index: number; q: Question }

interface Run {
  mode: ModeKind;
  world: string;
  queue: QRef[];
  pos: number;
  score: number;
  correct: number;
  timeLeft: number;
  timerId: number | null;
  frozen: boolean;
  lives: number;
  turn: 0 | 1;
  scores: [number, number];
  fiftyUsed: boolean;
  hiddenOptions: number[];
  shieldArmed: boolean;
  blitzEndsAt: number;
}

let run: Run | null = null;
let lastResult: ReturnType<typeof applySession> | null = null;
let lastRunMeta: { mode: ModeKind; label: string } | null = null;
let deferredInstall: any = null;

const TIME_WORLD = 20;
const TIME_BOSS = 25;
const BLITZ_MS = 60_000;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}
function qid(ref: QRef): string { return `${ref.world}:${ref.index}`; }
function level(): number { return levelFromXp(state.xp); }
function persist(): void { saveState(state); render(); }

/* ---------- audio & haptics (6) ---------- */
let audioCtx: AudioContext | null = null;
function beep(kind: 'good' | 'bad' | 'tick' | 'win'): void {
  if (!state.sound) return;
  try {
    audioCtx ??= new AudioContext();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    const freqs = { good: [660, 880], bad: [220, 160], tick: [520], win: [523, 659, 784] }[kind];
    freqs.forEach((f, i) => {
      const osc = audioCtx!.createOscillator(), gn = audioCtx!.createGain();
      osc.frequency.value = f; osc.type = kind === 'bad' ? 'sawtooth' : 'sine';
      gn.gain.setValueAtTime(0.08, audioCtx!.currentTime + i * 0.09);
      gn.gain.exponentialRampToValueAtTime(0.001, audioCtx!.currentTime + i * 0.09 + 0.14);
      osc.connect(gn).connect(audioCtx!.destination);
      osc.start(audioCtx!.currentTime + i * 0.09); osc.stop(audioCtx!.currentTime + i * 0.09 + 0.15);
    });
    o.disconnect(); g.disconnect();
  } catch { /* no audio */ }
  if (kind === 'bad') navigator.vibrate?.(80);
  if (kind === 'good') navigator.vibrate?.(30);
}

/* ---------- theme (17) & font (14) ---------- */
function applyTheme(): void {
  document.documentElement.dataset.theme = state.theme;
  document.body.classList.toggle('dysfont', state.dysFont);
}

/* ---------- splash removal ---------- */
window.addEventListener('load', () => setTimeout(() => document.getElementById('splash')?.classList.add('gone'), 1100));

/* ---------- service worker (12) ---------- */
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
window.addEventListener('beforeinstallprompt', (e: Event) => {
  e.preventDefault();
  deferredInstall = e;
  if (screen === 'home') render();
});

/* ============================================================ HOME */
function homeView(): string {
  const lv = level();
  const nextXp = xpForLevel(lv + 1);
  const prevXp = xpForLevel(lv);
  const pct = Math.min(100, Math.round(((state.xp - prevXp) / Math.max(1, nextXp - prevXp)) * 100));
  const installBtn = deferredInstall
    ? `<button class="btn ghost" id="btn-install">⬇️ Install app</button>` : '';
  const modes = `
    <div class="modes">
      <button class="btn special" id="btn-daily">📅 Daily Challenge</button>
      <button class="btn ghost" id="btn-blitz">⚡ Blitz 60s</button>
      <button class="btn ghost" id="btn-duel">⚔️ Hot-Seat Duel</button>
      <button class="btn ghost" id="btn-survival">💀 Endless Survival</button>
    </div>`;
  const cards = WORLDS.map((w, i) => {
    const unlocked = worldUnlocked(i, state);
    const stars = worldStars(w, state);
    const boss = unlocked && bossReady(w, state, bank);
    const meta = WORLD_META[w];
    return `<button class="world ${unlocked ? '' : 'locked'}" data-world="${w}" ${unlocked ? '' : 'disabled'}>
      <span class="wicon">${unlocked ? meta.icon : '🔒'}</span>
      <span class="wname">${meta.name}</span>
      <span class="wstars">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</span>
      ${boss ? '<span class="bossflag">👑 BOSS READY</span>' : ''}
      <span class="wbest">best ${state.best[w] ?? 0}</span>
    </button>`;
  }).join('');
  return `
  <header class="top">
    <div class="brand"><img src="/logo.svg" alt="" width="34"/> QUIZORA</div>
    <div class="hud">
      <span title="level">Lv ${lv}</span>
      <span title="xp">${state.xp} XP</span>
      <span title="coins">🪙 ${state.coins}</span>
      <span title="streak">🔥 ${state.streak}</span>
      ${POWERUP_META ? Object.entries(state.powerUps).filter(([, n]) => n > 0)
        .map(([k, n]) => `<span title="${k}">${POWERUP_META[k as PowerUpKind].icon}×${n}</span>`).join('') : ''}
    </div>
  </header>
  <div class="xpbar"><i style="width:${pct}%"></i><span>${state.xp}/${nextXp} → Lv ${lv + 1}</span></div>
  <nav class="tabs">
    <button data-nav="profile">👤 Profile</button>
    <button data-nav="leaders">🏆 Leaders</button>
    <button data-nav="notebook">📓 Mistakes (${openMistakes(state).length})</button>
    <button data-nav="settings">⚙️</button>
    ${installBtn}
  </nav>
  ${modes}
  <h2 class="sect">Worlds — conquer in order</h2>
  <div class="grid">${cards}</div>`;
}

/* ============================================================ PROFILE (5, 15, 16) */
function profileView(): string {
  const heat = heatmapDays(state, 14).map((d) =>
    `<i class="heat h${Math.min(3, d.sessions)}" title="${d.key}: ${d.sessions} sessions"></i>`).join('');
  const acc = accuracyByDifficulty(state, bank).map((r) => `
    <div class="accrow"><span>d${r.d}</span>
      <div class="accbar"><i style="width:${r.pct}%"></i></div>
      <em>${r.pct}% · ${r.seen} answered</em></div>`).join('');
  const ach = ACHIEVEMENTS.map((a) => {
    const got = state.achievements.includes(a.id);
    return `<div class="ach ${got ? `got r-${a.rarity}` : ''}">
      <b>${a.name}</b><span class="chip ${a.rarity}">${a.rarity}</span><p>${a.desc}</p></div>`;
  }).join('');
  return `<header class="top"><button class="btn ghost" data-nav="home">← Home</button><h2>Profile</h2></header>
  <section class="card"><h3>Last 14 days</h3><div class="heatmap">${heat}</div>
    <p class="muted">Lifetime: ${Object.values(state.qstats).reduce((a, q) => a + q.seen, 0)} answers · streak best guard 🔥${state.streak}</p></section>
  <section class="card"><h3>Accuracy by difficulty</h3>${acc}</section>
  <section class="card"><h3>Achievements (${state.achievements.length}/${ACHIEVEMENTS.length})</h3>
    <div class="achgrid">${ach}</div></section>`;
}

/* ============================================================ LEADERBOARD (3) */
function leadersView(): string {
  const rows = state.leaderboard.map((r, i) =>
    `<tr><td>${['🥇', '🥈', '🥉'][i] ?? i + 1}</td><td>${esc(r.label)}</td><td><b>${r.score}</b></td><td class="muted">${r.date}</td></tr>`).join('')
    || '<tr><td colspan="4" class="muted">No runs yet — go set a score!</td></tr>';
  return `<header class="top"><button class="btn ghost" data-nav="home">← Home</button><h2>🏆 Hall of Fame</h2></header>
  <table class="tbl"><thead><tr><th>#</th><th>Mode / World</th><th>Score</th><th>Date</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/* ============================================================ NOTEBOOK (10) */
function notebookView(): string {
  const open = openMistakes(state);
  const items = open.map((m) => {
    const q = bank[m.world]?.[m.index];
    if (!q) return '';
    return `<div class="card mistake">
      <span class="tag">${WORLD_META[m.world]?.icon} ${WORLD_META[m.world]?.name}</span>
      <p><b>${esc(q.q)}</b></p>
      <p class="ok">✔ ${esc(q.options[q.correct])}</p>
      <p class="muted">${esc(q.explain)}</p>
      <button class="btn small" data-review="${m.world}:${m.index}">✓ reviewed</button>
    </div>`;
  }).join('') || '<p class="muted center">Notebook empty — every miss gets logged here for review. 🎉</p>';
  const practiceBtn = open.length >= 4
    ? `<button class="btn primary" id="btn-practice-mistakes">🎯 Practice ${Math.min(QUESTIONS_PER_SESSION, open.length)} mistakes</button>` : '';
  return `<header class="top"><button class="btn ghost" data-nav="home">← Home</button><h2>📓 Mistake Notebook</h2></header>
  ${practiceBtn}${items}`;
}

/* ============================================================ SETTINGS (4, 13, 17) */
function settingsView(): string {
  const themeBtns = THEMES.map((t) => {
    const un = themeUnlocked(t.id, state);
    return `<button class="btn ${state.theme === t.id ? 'primary' : 'ghost'}" data-theme-set="${t.id}" ${un ? '' : 'disabled'}>
      ${t.name}${un ? '' : ` (Lv ${t.minLevel})`}</button>`;
  }).join('');
  const syncCfg = getSyncCfg();
  return `<header class="top"><button class="btn ghost" data-nav="home">← Home</button><h2>⚙️ Settings</h2></header>
  <section class="card"><h3>Packs</h3>
    <p class="muted">Export your bank or merge your own JSON packs (same schema).</p>
    <button class="btn" id="btn-export-pack">⬆️ Export bank JSON</button>
    <label class="btn file">⬇️ Import pack<input type="file" id="file-pack" accept=".json" hidden></label>
    ${state.packs.length ? `<p class="ok">Imported: ${state.packs.map(esc).join(', ')}</p>` : ''}
  </section>
  <section class="card"><h3>Feel</h3>
    <label class="switchrow"><input type="checkbox" id="sw-sound" ${state.sound ? 'checked' : ''}> Sound effects</label>
    <label class="switchrow"><input type="checkbox" id="sw-dys" ${state.dysFont ? 'checked' : ''}> Dyslexia-friendly font</label>
    <div class="themebtns">${themeBtns}</div>
  </section>
  <section class="card"><h3>Cloud sync via GitHub Gist</h3>
    <p class="muted">Uses <b>your own</b> personal-access token; nothing is sent anywhere else. Leave blank to skip.</p>
    <input id="sync-pat" type="password" placeholder="GitHub PAT (gist scope)" value="${esc(syncCfg.pat)}"/>
    <input id="sync-gist" placeholder="Gist ID" value="${esc(syncCfg.gistId)}"/>
    <div class="rowgap"><button class="btn" id="btn-sync-push">☁️ Push state</button>
    <button class="btn" id="btn-sync-pull">⬇️ Pull state</button></div>
    <p id="sync-msg" class="muted"></p>
  </section>
  <section class="card danger-zone"><button class="btn danger" id="btn-reset">☠️ Reset all progress</button></section>`;
}

function getSyncCfg(): { pat: string; gistId: string } {
  try { return JSON.parse(localStorage.getItem('quizora_sync_cfg') ?? '{"pat":"","gistId":""}'); }
  catch { return { pat: '', gistId: '' }; }
}

async function gistPush(): Promise<void> {
  const cfg = getSyncCfg();
  const msg = document.getElementById('sync-msg');
  if (!cfg.pat || !cfg.gistId) { if (msg) msg.textContent = 'Set PAT and Gist ID first.'; return; }
  const res = await fetch(`https://api.github.com/gists/${cfg.gistId}`, {
    method: 'PATCH',
    headers: { Authorization: `token ${cfg.pat}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ files: { 'quizora-state.json': { content: JSON.stringify(state) } } }),
  });
  if (msg) msg.textContent = res.ok ? '✅ Pushed to gist' : `❌ Failed (${res.status})`;
}

async function gistPull(): Promise<void> {
  const cfg = getSyncCfg();
  const msg = document.getElementById('sync-msg');
  if (!cfg.pat || !cfg.gistId) { if (msg) msg.textContent = 'Set PAT and Gist ID first.'; return; }
  const res = await fetch(`https://api.github.com/gists/${cfg.gistId}`, { headers: { Authorization: `token ${cfg.pat}` } });
  if (!res.ok) { if (msg) msg.textContent = `❌ Failed (${res.status})`; return; }
  const json: any = await res.json();
  const content = json.files?.['quizora-state.json']?.content;
  if (!content) { if (msg) msg.textContent = '❌ No quizora-state.json in that gist'; return; }
  localStorage.setItem('quizora_state_v1', content);
  location.reload();
}

function exportPack(): void {
  const blob = new Blob([JSON.stringify(bank, null, 1)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'quizora-bank.json';
  a.click();
}

async function importPack(file: File): Promise<void> {
  try {
    const parsed = JSON.parse(await file.text()) as Record<string, Question[]>;
    let added = 0;
    for (const w of Object.keys(parsed)) {
      if (!Array.isArray(bank[w])) continue;
      for (const q of parsed[w]) {
        if (bank[w].length >= 200) break;
        if (!q?.q || !Array.isArray(q.options) || q.correct == null) continue;
        bank[w].push(q);
        added++;
      }
    }
    const name = file.name.replace(/\.json$/i, '');
    if (!state.packs.includes(name)) state.packs.push(name);
    if (!state.achievements.includes('collector')) state.achievements.push('collector');
    alert(`Imported ${added} questions into the bank.`);
    persist();
  } catch { alert('Invalid pack file.'); }
}

/* ---------- shareable PNG card (19) ---------- */
function shareCardPng(): void {
  if (!lastResult) return;
  const c = document.createElement('canvas');
  c.width = 800; c.height = 420;
  const x = c.getContext('2d')!;
  const grad = x.createLinearGradient(0, 0, 800, 420);
  grad.addColorStop(0, '#131a3f'); grad.addColorStop(1, '#070b1a');
  x.fillStyle = grad; x.fillRect(0, 0, 800, 420);
  x.fillStyle = '#8ea2ff'; x.font = 'bold 44px sans-serif';
  x.fillText('QUIZORA', 40, 70);
  x.fillStyle = '#93a5c8'; x.font = '18px sans-serif';
  x.fillText(`${lastRunMeta?.label ?? lastResult.world} · ${todayKey()}`, 40, 100);
  x.fillStyle = '#fff'; x.font = 'bold 96px sans-serif';
  x.fillText(String(lastResult.score), 40, 230);
  x.fillStyle = '#34d399'; x.font = '28px sans-serif';
  x.fillText(`✔ ${lastResult.correct}/${lastResult.total} correct`, 40, 280);
  x.fillStyle = '#ffd166'; x.font = '24px sans-serif';
  x.fillText(`🔥 ${state.streak}-day streak · Lv ${level()}`, 40, 320);
  x.fillStyle = '#93a5c8'; x.font = '16px sans-serif';
  x.fillText('Conquer knowledge, one world at a time.', 40, 380);
  const a = document.createElement('a');
  a.href = c.toDataURL('image/png');
  a.download = 'quizora-score.png';
  a.click();
}

/* ============================================================ SESSION RUNNER */
function buildQueue(mode: ModeKind, world: string): QRef[] {
  const toRefs = (ws: string[], idxs: number[][]): QRef[] =>
    idxs.flatMap((ix, k) => ix.map((i) => ({ world: ws[k] ?? ws[0], index: i, q: (bank[ws[k] ?? ws[0]] ?? [])[i] })))
      .filter((r) => r.q);
  if (mode === 'world') return toRefs([world], [pickSession(bank, world, level(), state.qstats)]);
  if (mode === 'boss') return toRefs([world], [pickBoss(bank, world, state.qstats)]);
  if (mode === 'daily') return pickDaily(bank).map((p) => ({ world: p.world, index: p.index, q: p.q }));
  if (mode === 'survival') {
    const pool: QRef[] = [];
    WORLDS.forEach((w) => { if (worldUnlocked(WORLDS.indexOf(w), state)) (bank[w] ?? []).forEach((q, i) => pool.push({ world: w, index: i, q })); });
    const rng = mulberry32(Date.now() >>> 0);
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    return pool.slice(0, 60);
  }
  // blitz & duel: random mix across unlocked worlds
  const refs: QRef[] = [];
  const worlds = WORLDS.filter((_, i) => worldUnlocked(i, state));
  while (refs.length < QUESTIONS_PER_SESSION) {
    const w = worlds[Math.floor(Math.random() * worlds.length)];
    const i = Math.floor(Math.random() * (bank[w]?.length ?? 0));
    if ((bank[w] ?? [])[i]) refs.push({ world: w, index: i, q: bank[w][i] });
  }
  return refs;
}

function startRun(mode: ModeKind, world = ''): void {
  touchStreak(state);
  run = {
    mode, world,
    queue: buildQueue(mode, world),
    pos: 0, score: 0, correct: 0,
    timeLeft: mode === 'boss' ? TIME_BOSS : TIME_WORLD,
    timerId: null, frozen: false,
    lives: mode === 'survival' ? 3 : mode === 'boss' ? 1 : 0,
    turn: 0, scores: [0, 0],
    fiftyUsed: false, hiddenOptions: [],
    shieldArmed: state.powerUps.shield > 0 && (mode === 'survival' || mode === 'boss'),
    blitzEndsAt: mode === 'blitz' ? Date.now() + BLITZ_MS : 0,
  };
  if (!run.queue.length) { alert('No questions available.'); run = null; return; }
  screen = 'game';
  askQuestion();
}

function askQuestion(): void {
  if (!run) return;
  if (run.mode === 'blitz' && Date.now() >= run.blitzEndsAt) return endBlitz();
  if (run.pos >= run.queue.length) return finishRun();
  run.fiftyUsed = false;
  run.hiddenOptions = [];
  if (run.mode !== 'blitz') {
    run.timeLeft = run.mode === 'boss' ? TIME_BOSS : TIME_WORLD;
    run.frozen = false;
    clearInterval(run.timerId!);
    run.timerId = window.setInterval(() => {
      if (!run || run.frozen) return;
      run.timeLeft -= 0.1;
      const bar = document.getElementById('tbar');
      const tnum = document.getElementById('tnum');
      if (bar) bar.style.width = `${Math.max(0, (run.timeLeft / (run.mode === 'boss' ? TIME_BOSS : TIME_WORLD)) * 100)}%`;
      if (tnum) tnum.textContent = `${Math.ceil(run.timeLeft)}s`;
      if (run.timeLeft <= 0) answer(null);
    }, 100);
  }
  renderQuestion();
}

function currentQ(): QRef | null { return run ? run.queue[run.pos] : null; }

function questionView(): string {
  const ref = currentQ()!;
  const q = ref.q;
  const meta = WORLD_META[ref.world];
  const duelBanner = run!.mode === 'duel'
    ? `<div class="duelbanner">Player ${run!.turn + 1}'s turn · P1: <b>${run!.scores[0]}</b> P2: <b>${run!.scores[1]}</b></div>` : '';
  const lives = run!.lives > 0 ? `<span class="lives">${'❤️'.repeat(run!.lives)}</span>` : '';
  const blitzLeft = run!.mode === 'blitz'
    ? `<span id="blitzclock">⚡ ${Math.max(0, Math.ceil((run!.blitzEndsAt - Date.now()) / 1000))}s</span>` : '';
  const timerRow = run!.mode === 'blitz' ? blitzLeft
    : `<div class="timer"><span id="tnum">${Math.ceil(run!.timeLeft)}s</span><div class="tbarwrap"><i id="tbar"></i></div>${run!.frozen ? '❄️' : ''}</div>`;
  const opts = q.options.map((o, i) => `
    <button class="opt ${run!.hiddenOptions.includes(i) ? 'hidden50' : ''}" data-opt="${i}" key="${i}">
      <b>${'ABCD'[i]}.</b> ${esc(o)}</button>`).join('');
  const flagged = state.flagged.includes(qid(ref));
  const powerBtns = (['fifty', 'freeze'] as PowerUpKind[]).map((k) => `
    <button class="btn small ghost" data-power="${k}" ${state.powerUps[k] > 0 && !(k === 'freeze' && run!.frozen) ? '' : 'disabled'}>
      ${POWERUP_META[k].icon} ${POWERUP_META[k].name} ×${state.powerUps[k]}</button>`).join('');
  return `
  ${duelBanner}
  <div class="qhead">
    <span class="tag">${meta?.icon} ${meta?.name}</span>
    <span class="dots">${'●'.repeat(q.d)}<span class="dim">${'●'.repeat(5 - q.d)}</span></span>
    <span class="muted">#${run!.pos + 1}/${run!.queue.length}</span>
    ${lives}
  </div>
  ${timerRow}
  <h2 class="qtext">${esc(q.q)}</h2>
  <div class="opts">${opts}</div>
  <div class="qfoot">
    ${powerBtns}
    <button class="btn small ghost" id="btn-freeze-off" style="display:none"></button>
    <button class="btn small ghost" id="btn-flag">${flagged ? '🚩 flagged' : '🏳️ flag'}</button>
    <button class="btn small danger" id="btn-quit">quit</button>
  </div>
  <p class="keyhint muted">keys: 1-4 answer${run!.mode !== 'duel' ? ' · Enter continue' : ''}</p>`;
}

function answer(chosen: number | null): void {
  if (!run) return;
  const ref = currentQ()!;
  const wasCorrect = chosen === ref.q.correct;
  let shieldSaved = false;
  if (!wasCorrect && run.shieldArmed && usePowerUp(state, 'shield')) {
    run.shieldArmed = state.powerUps.shield > 0; // next miss unprotected unless re-bought
    shieldSaved = true;
  }
  const secondsTotal = run.mode === 'boss' ? TIME_BOSS : TIME_WORLD;
  let gained = 0;
  if (wasCorrect) {
    gained = scoreAnswer(ref.q, Math.max(0, run.timeLeft / secondsTotal));
    run.score += gained;
    run.correct += 1;
    beep('good');
  } else if (!shieldSaved) {
    beep('bad');
    recordMistake(state, ref.world, ref.index, qid(ref));
    if (run.lives > 0) {
      run.lives -= 1;
      if (run.lives <= 0) return finishRun();
    }
  } else {
    toast('🛡️ Shield saved you!');
  }
  if (run.mode === 'duel') {
    run.scores[run.turn] += gained;
    run.turn = run.turn === 0 ? 1 : 0;
  }
  if (run.timerId) clearInterval(run.timerId);
  showFeedback(ref, chosen, wasCorrect, shieldSaved, gained);
}

function showFeedback(ref: QRef, chosen: number | null, ok: boolean, saved: boolean, gained: number): void {
  document.querySelectorAll('.opt').forEach((b) => {
    const i = Number((b as HTMLElement).dataset.opt);
    b.classList.add('lock');
    if (i === ref.q.correct) b.classList.add('correct');
    else if (i === chosen) b.classList.add('wrong');
  });
  const verdict = document.getElementById('verdict')!;
  verdict.className = `verdict ${ok ? 'ok' : 'bad'}`;
  verdict.textContent = ok ? `✅ Correct! +${gained}` : saved ? '🛡️ Shield absorbed the miss' : chosen === null ? '⏱ Time!' : '❌ Miss';
  document.getElementById('explain')!.textContent = ref.q.explain;
  const btn = document.getElementById('btn-next')!;
  btn.hidden = false;
  btn.focus();
}

/* ---------- finishes ---------- */
function finishRun(): void {
  if (!run) return;
  const r = run;
  if (r.timerId) clearInterval(r.timerId);

  if (r.mode === 'duel') {
    const win = r.scores[0] === r.scores[1] ? null : r.scores[0] > r.scores[1] ? 0 : 1;
    if (win !== null && !state.achievements.includes('duel-champ')) state.achievements.push('duel-champ');
    lastResult = { world: 'Duel', score: Math.max(...r.scores), correct: r.correct, total: r.queue.length, xpGained: 0, coinsGained: 0, newAchievements: [] };
    lastRunMeta = { mode: 'duel', label: `Duel · P1 ${r.scores[0]} vs P2 ${r.scores[1]} ${win === null ? '(draw)' : `(P${win + 1} wins)`}` };
  } else if (r.mode === 'blitz') {
    if (r.score >= 400 && !state.achievements.includes('blitz-ace')) state.achievements.push('blitz-ace');
    state.xp += r.score; state.coins += r.correct * 5;
    insertLeaderRow(state, { score: r.score, label: '⚡ Blitz', date: todayKey() });
    maybeGrantPowerUp();
    lastResult = { world: 'Blitz', score: r.score, correct: r.correct, total: r.pos, xpGained: r.score, coinsGained: r.correct * 5, newAchievements: [] };
    lastRunMeta = { mode: 'blitz', label: '⚡ Blitz 60s' };
  } else if (r.mode === 'survival') {
    if (10 - r.lives >= 10 - 0 && r.pos >= 10 && !state.achievements.includes('survivor-10')) state.achievements.push('survivor-10');
    state.xp += r.score; state.coins += r.correct * 5;
    insertLeaderRow(state, { score: r.score, label: '💀 Survival', date: todayKey() });
    maybeGrantPowerUp();
    lastResult = { world: 'Survival', score: r.score, correct: r.correct, total: r.pos, xpGained: r.score, coinsGained: r.correct * 5, newAchievements: [] };
    lastRunMeta = { mode: 'survival', label: '💀 Endless Survival' };
  } else if (r.mode === 'boss') {
    const won = r.correct >= Math.ceil(r.queue.length * 0.8);
    if (won && !state.achievements.includes('boss-slayer')) state.achievements.push('boss-slayer');
    const res = applySession(state, r.world, r.queue.map((ref) => ({
      index: ref.index, question: ref.q, chosen: null, secondsUsed: 0, secondsTotal: TIME_BOSS,
    })));
    res.score = r.score; res.correct = r.correct; res.total = r.queue.length;
    insertLeaderRow(state, { score: r.score, label: `👑 Boss ${WORLD_META[r.world]?.name}`, date: todayKey() });
    maybeGrantPowerUp();
    lastResult = { ...res };
    lastRunMeta = { mode: 'boss', label: `👑 Boss · ${WORLD_META[r.world]?.name} ${won ? 'DEFEATED' : 'survived'}` };
  } else {
    // normal world session — full engine path
    const answers = r.queue.slice(0, r.pos).map((ref, i) => {
      void i;
      return { index: ref.index, question: ref.q, chosen: null, secondsUsed: 0, secondsTotal: TIME_WORLD };
    });
    const res = applySession(state, r.world, answers);
    insertLeaderRow(state, { score: res.score, label: WORLD_META[r.world]?.name ?? r.world, date: todayKey() });
    maybeGrantPowerUp();
    lastResult = res;
    lastRunMeta = { mode: 'world', label: `${WORLD_META[r.world]?.icon} ${WORLD_META[r.world]?.name}` };
  }
  run = null;
  persist(); // persists + rerenders current screen; switch below
  screen = 'results';
  render();
}

function endBlitz(): void {
  if (run?.timerId) clearInterval(run.timerId);
  finishRun();
}

let puToast = '';
function maybeGrantPowerUp(): void {
  const kind = grantPowerUp(state);
  if (kind) puToast = `${POWERUP_META[kind].icon} Level-up power-up: ${POWERUP_META[kind].name}!`;
}

function toast(msg: string): void {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1800);
}

/* ============================================================ RESULTS */
function resultsView(): string {
  const r = lastResult!;
  const pct = r.total ? Math.round((r.correct / r.total) * 100) : 0;
  return `
  <section class="card center resultcard">
    <div class="rring" style="--p:${pct}"><b>${pct}%</b></div>
    <h2>${lastRunMeta?.label}</h2>
    <p class="bigscore">${r.score} pts</p>
    <p>✔ ${r.correct}/${r.total} · +${r.xpGained} XP · 🪙+${r.coinsGained}</p>
    ${puToast ? `<p class="ok">${esc(puToast)}</p>` : ''}
    ${r.newAchievements.length ? `<p class="ok">🏅 New: ${r.newAchievements.join(', ')}</p>` : ''}
    <div class="rowgap">
      <button class="btn primary" id="btn-share-png">🖼 Save score card</button>
      <button class="btn" data-nav="home">🏠 Home</button>
    </div>
  </section>`;
}

/* ============================================================ RENDER & EVENTS */
function gameView(): string {
  return `<div id="verdict" class="verdict" hidden></div><div id="explain" class="explain" hidden></div>
  <button id="btn-next" class="btn primary" hidden>Continue →</button>${questionView()}`;
}

function renderQuestion(): void {
  app.innerHTML = gameView();
  bindGameEvents();
}

function render(): void {
  applyTheme();
  const views: Record<Screen, () => string> = {
    home: homeView, profile: profileView, leaders: leadersView,
    notebook: notebookView, settings: settingsView, game: gameView,
    results: resultsView,
  };
  app.innerHTML = views[screen]();
  if (screen === 'game') bindGameEvents();
}

app.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;

  const nav = t.closest('[data-nav]') as HTMLElement | null;
  if (nav) { screen = nav.dataset.nav as Screen; render(); return; }

  const themeBtn = t.closest('[data-theme-set]') as HTMLElement | null;
  if (themeBtn) { state.theme = themeBtn.dataset.themeSet!; persist(); return; }

  if (t.id === 'btn-install' && deferredInstall) { deferredInstall.prompt(); deferredInstall = null; return; }

  const worldBtn = t.closest('[data-world]') as HTMLElement | null;
  if (worldBtn) { startRun(worldBtn.dataset.boss ? 'boss' : 'world', worldBtn.dataset.world!); return; }

  const bossWrap = t.closest('.world') as HTMLElement | null;
  const bossBtn = t.closest('.bossflag') as HTMLElement | null;
  if (bossBtn && bossWrap) { startRun('boss', bossWrap.dataset.world!); return; }

  if (t.id === 'btn-daily') return startRun('daily');
  if (t.id === 'btn-blitz') return startRun('blitz');
  if (t.id === 'btn-duel') return startRun('duel');
  if (t.id === 'btn-survival') return startRun('survival');

  if (t.id === 'btn-export-pack') return exportPack();
  if (t.id === 'btn-sync-push') return void gistPush();
  if (t.id === 'btn-sync-pull') return void gistPull();
  if (t.id === 'btn-reset' && confirm('Wipe ALL progress?')) { resetState(); state = loadState(); location.reload(); return; }
  if (t.id === 'btn-share-png') return shareCardPng();

  const review = t.closest('[data-review]') as HTMLElement | null;
  if (review) {
    const [w, i] = review.dataset.review!.split(':');
    const m = state.mistakes.find((x) => x.world === w && x.index === Number(i) && !x.reviewedAt);
    if (m) m.reviewedAt = Date.now();
    persist();
    return;
  }
  if (t.id === 'btn-practice-mistakes') {
    const refs = openMistakes(state).slice(0, QUESTIONS_PER_SESSION)
      .map((m) => ({ world: m.world, index: m.index, q: bank[m.world]?.[m.index] })).filter((r) => r.q);
    touchStreak(state);
    run = {
      mode: 'world', world: 'mistakes',
      queue: refs, pos: 0, score: 0, correct: 0,
      timeLeft: TIME_WORLD, timerId: null, frozen: false, lives: 0,
      turn: 0, scores: [0, 0], fiftyUsed: false, hiddenOptions: [],
      shieldArmed: false, blitzEndsAt: 0,
    };
    screen = 'game';
    askQuestion();
    return;
  }
});

document.getElementById('file-pack')?.addEventListener('change', async (e) => {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (f) await importPack(f);
});

document.addEventListener('change', (e) => {
  const t = e.target as HTMLInputElement;
  if (t.id === 'sw-sound') { state.sound = t.checked; saveState(state); }
  if (t.id === 'sw-dys') { state.dysFont = t.checked; saveState(state); applyTheme(); }
});

document.addEventListener('keydown', (e) => {
  if (screen !== 'game' || !run) return;
  const fbOpen = !document.getElementById('btn-next')?.hidden;
  if (fbOpen && (e.key === 'Enter' || e.key === ' ')) { (document.getElementById('btn-next') as HTMLButtonElement).click(); return; }
  if (!fbOpen && ['1', '2', '3', '4'].includes(e.key)) answer(Number(e.key) - 1);
});

/* delegated settings inputs */
document.addEventListener('input', (e) => {
  const t = e.target as HTMLInputElement;
  if (t.id === 'sync-pat' || t.id === 'sync-gist') {
    localStorage.setItem('quizora_sync_cfg', JSON.stringify({
      pat: (document.getElementById('sync-pat') as HTMLInputElement).value,
      gistId: (document.getElementById('sync-gist') as HTMLInputElement).value,
    }));
  }
});

/* per-question bindings (delegated on #app for dynamic DOM) */
function bindGameEvents(): void {
  const blitzId = run?.mode === 'blitz' ? window.setInterval(() => {
    const el = document.getElementById('blitzclock');
    if (el && run) el.textContent = `⚡ ${Math.max(0, Math.ceil((run.blitzEndsAt - Date.now()) / 1000))}s`;
  }, 250) : null;
  if (blitzId && run) run.timerId = blitzId;

  app.querySelectorAll('.opt').forEach((b) => b.addEventListener('click', () => {
    if ((b as HTMLElement).classList.contains('lock')) return;
    answer(Number((b as HTMLElement).dataset.opt));
  }));

  app.querySelectorAll('[data-power]').forEach((b) => b.addEventListener('click', () => {
    const kind = (b as HTMLElement).dataset.power as PowerUpKind;
    if (!run || !usePowerUp(state, kind)) return;
    if (kind === 'fifty') {
      const ref = currentQ()!;
      const wrongs = ref.q.options.map((_, i) => i).filter((i) => i !== ref.q.correct);
      run.hiddenOptions = wrongs.sort(() => Math.random() - 0.5).slice(0, 2);
      renderQuestion();
    }
    if (kind === 'freeze') {
      run.frozen = true;
      toast('❄️ Timer frozen this question');
      const t = document.querySelector('.timer');
      if (t) t.insertAdjacentHTML('beforeend', '<span class="frost">❄️ frozen</span>');
    }
  }));

  const flagBtn = document.getElementById('btn-flag');
  flagBtn?.addEventListener('click', () => {
    const ref = currentQ()!;
    const id = qid(ref);
    state.flagged = state.flagged.includes(id) ? state.flagged.filter((x) => x !== id) : [...state.flagged, id];
    saveState(state);
    flagBtn.textContent = state.flagged.includes(id) ? '🚩 flagged' : '🏳️ flag';
  });

  document.getElementById('btn-quit')?.addEventListener('click', () => {
    if (run?.timerId) clearInterval(run.timerId);
    if (confirm('Quit this run? Progress is lost.')) { run = null; screen = 'home'; render(); }
  });

  document.getElementById('btn-next')?.addEventListener('click', () => {
    if (!run) return;
    run.pos += 1;
    if (run.mode === 'survival') {
      // ramp: every 5 answered, swap in harder slice by re-shuffling remaining queue desc difficulty
      if (run.pos > 0 && run.pos % 5 === 0) {
        run.queue.slice(run.pos).sort((a, b) => b.q.d - a.q.d);
        toast('📈 Difficulty rising!');
      }
    }
    askQuestion();
  });
}

/* boot */
state = touchStreak(state);
saveState(state);
render();
