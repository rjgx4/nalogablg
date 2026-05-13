# blginc

Free public tool that analyzes how a website appears in ChatGPT and Gemini for buying-journey prompts.

**v1 (MVP) scope:** URL input → crawl homepage area → generate 5 prompts (awareness / consideration / decision / problem-focused / solution-focused) via Gemini 2.5 Flash.

## Stack

- **frontend** — Vite + React, single URL input. Calls Restate ingress directly via Vite's dev proxy.
- **restate-service** — Node.js workflow (`@restatedev/restate-sdk`): `crawl` → `generatePrompts`

Local dev runs `restate-server` on your laptop. No Restate Cloud, no deploy yet.

> **MVP shortcut:** the frontend hits Restate's ingress directly (proxied through Vite). That's fine locally because `restate-server` runs without auth on `localhost`. Before this ships publicly, we'll need a proxy in front (Cloudflare Worker) to hold any deployed Restate's bearer token, validate URLs, and rate-limit per IP.

## Prerequisites

- Node 20+
- `restate-server` and `restate` CLI — see [Restate quickstart](https://docs.restate.dev/get_started/quickstart)
- Cloudflare account with Browser Rendering enabled + API token scoped for it
- Gemini API key (https://aistudio.google.com/apikey)

## Setup

```sh
npm install
cp packages/restate-service/.env.example packages/restate-service/.env
# fill in CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, GEMINI_API_KEY
```

## Run (3 terminals + one-off register)

1. **Restate server:** `restate-server`
2. **Restate service:** `npm run dev:restate` (listens on :9080)
3. **Register service** (first time and after handler signature changes): `restate deployments register http://localhost:9080`
4. **Frontend:** `npm run dev:frontend` (vite on :5173)

Open http://localhost:5173, paste a URL, click Analyze.

## Request flow

```
browser ──POST /restate/Analyzer/<uuid>/run──▶ Vite dev proxy
                                                    │
                                                    ▼
                                          Restate ingress (:8080)
                                                    │
                                                    ▼
                                            Analyzer/<uuid>/run
                                                    │
                                       ┌────────────┴────────────┐
                                       ▼                         ▼
                                ctx.run("crawl")        ctx.run("generatePrompts")
                                       │                         │
                                       ▼                         ▼
                              Cloudflare /crawl          Gemini 2.5 Flash
```

Each `ctx.run` is a durable checkpoint — if Gemini fails after a successful crawl, retrying the workflow won't re-crawl.
