# 🛸 Quizora — Deep-Space Quiz Adventure

A gamified quiz game that runs anywhere: **10 worlds × adaptive levels, 250
questions**, spaced-repetition-style question picking, XP, coins, streaks and
achievements — all offline in your browser. No dependencies at runtime, no
accounts, no tracking.

## Features

- **10 worlds**: Web Basics · JavaScript · Python · Data & DB · Math & Logic · Science · Space · Geography · History · General Knowledge
- **250 hand-authored questions** with explanations and difficulty ratings (1–5)
- **Adaptive engine**: unseen questions first, wrong answers get retrained, difficulty matches your level (SM-2-lite scheduling)
- **Gamification**: XP → level curve, coins, day-streaks, 7 achievements, best scores per world
- **20s timer** per question with speed bonus scoring
- **Everything in `localStorage`** (`quizora_state_v1`) — reset anytime from profile

## Run

```bash
npm install
npm run dev              # http://localhost:5173
npm test                 # 14 unit tests (engine, picker, streaks, bank integrity)
npm run build            # production build to dist/
npm run generate:questions   # regenerate the question bank deterministically
```

## Deploy

Static Vite build — works on Vercel, Netlify, or GitHub Pages as-is.

## Data honesty

All questions are static educational content bundled with the app; player
progress never leaves the device.
