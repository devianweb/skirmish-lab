# Deployment Guide

This guide covers deploying the SkirmishLab demo using **GitHub Pages** (for the client) and a free WebSocket host (for the signaling server).

## Overview

- **Client**: Static Vite app hosted on GitHub Pages
- **Signaling Server**: Node.js WebSocket server hosted on [Railway](https://railway.app/) or [Fly.io](https://fly.io/) (free tier), tracking the `release` branch
- **CI/CD**: GitHub Actions - PRs build and test only; merges/pushes to the `release` branch build, test, and deploy the client to GitHub Pages. Merge `main` → `release` when ready to demo.

## 1) Deploy the Signaling Server

You need a persistent WebSocket server reachable over `wss://`. Recommended host: Railway.

### Railway (Recommended)

> **Monorepo note:** do **not** set the service Root Directory to `server/`. The server depends on `@skirmish-lab/shared`, which is an npm workspace resolved via the root `package-lock.json` — installing from `server/` alone would fail. The repo root contains a `railway.json` that tells Railway how to build and start the server, so most of the configuration is already in the repo.

1. Sign up at [railway.app](https://railway.app/) and connect your GitHub account.
2. Create a new project → Deploy from GitHub repo → select `devianweb/skirmish-lab`.
3. Leave the service root at the repo root (Railway picks up `railway.json`, which provides the build and start commands below). If Railway does not pick it up, set these in the service settings manually:
   - Custom Build Command: `npm run build --workspace=shared && npm run build --workspace=server`
   - Custom Start Command: `node server/dist/index.js`
4. In the service settings → Source, set the **branch to track** to `release` (so it auto-deploys only when you merge to `release`).
5. In Settings → Networking, generate a public domain. Use `wss://<your-app>.up.railway.app` as `VITE_SIGNALING_URL`.

The server already listens on `process.env.PORT` (`server/src/index.ts`), which Railway provides.

### Fly.io (Alternative)

1. Install [flyctl](https://fly.io/docs/hands-on/install-flyctl/), sign up, and login.
2. From `server/`, run `fly launch` to create an app.
3. Set the internal port to match your server (8080) and configure to listen on `0.0.0.0:$PORT`.
4. Deploy with `fly deploy`. You'll get a `*.fly.dev` domain with HTTPS/WSS.

> Note: Render's free tier spins down on inactivity and can break WebSocket connections; avoid for this demo.

## 2) Configure the Client for the Deployed Server

Already implemented in the repo:

- `client/src/network/SignalingClient.ts` defaults its URL to `import.meta.env.VITE_SIGNALING_URL ?? 'ws://localhost:8080'`.
- `client/vite.config.ts` sets `base: '/skirmish-lab/'` for GitHub Pages.
- `client/src/vite-env.d.ts` declares the `VITE_SIGNALING_URL` type.

For local development, leave the env var unset to use `ws://localhost:8080`.

## 3) Set Up GitHub Pages

1. Go to your repo → Settings → Pages
2. Source: **GitHub Actions**
3. Save

## 4) GitHub Actions Workflows

Both workflows live in the repo — see `.github/workflows/`:

- **`.github/workflows/ci.yml`** — PR checks: triggers on PRs to `master` (and pushes to `master`). Runs `npm ci`, builds all workspaces (root build script orders them shared → client → server, since client/server compile against `shared/dist`), and runs all workspace tests. **Never deploys.**
- **`.github/workflows/deploy.yml`** — release deploys: triggers only on pushes to `release`. Builds and tests everything, rebuilds the client with `VITE_SIGNALING_URL` from repo secrets, and deploys `client/dist` to GitHub Pages via the official Pages actions.

To change CI/deploy behavior, edit those files — this document only describes them.

## 5) Add Secrets

In your repo → Settings → Secrets and variables → Actions, add:
- `VITE_SIGNALING_URL` = `wss://your-server-domain` (from Railway/Fly.io)

## 6) Deploy

1. Push the workflows and client config changes (done via the Phase 3.5 PR), and create the `release` branch once: `git push origin master:release`.
2. When ready to demo, merge `master` into `release` and push: `git checkout release && git merge master && git push`
3. Railway will auto-deploy the server from `release`. GitHub Actions will build, test, and deploy the client to GitHub Pages from `release`. Check the Actions tab for progress.
4. Once deployed, visit `https://devianweb.github.io/skirmish-lab/`
5. Share with friends - they can create/join rooms and connect over WebRTC via your signaling server.

## Troubleshooting

| Issue | Fix |
|---|---|
| Client can't connect to server | Ensure `VITE_SIGNALING_URL` is set in the deploy workflow secret and uses `wss://`. Check CORS/firewall not blocking WebSocket connections. |
| Assets fail to load on Pages | Verify `base` in `client/vite.config.ts` matches your repo name. |
| Server cold start delays | Free hosts may sleep; first connection can take a few seconds. Retry if needed. |
| Mixed content errors | GitHub Pages is HTTPS, so the server must be reachable over WSS. |
| PRs triggering deploys | Ensure the deploy workflow only triggers on the `release` branch as shown above. |

## Notes

- After WebRTC connects, the signaling server is no longer needed for game traffic (per architecture).
- Rooms are ephemeral and cleaned up by the server.
- This is intended for demos/friends - not hardened for public internet scale.
