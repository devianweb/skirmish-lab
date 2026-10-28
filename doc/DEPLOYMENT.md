# Deployment Guide

This guide covers deploying the Trench Heresy demo using **GitHub Pages** (for the client) and a free WebSocket host (for the signaling server).

## Overview

- **Client**: Static Vite app hosted on GitHub Pages
- **Signaling Server**: Node.js WebSocket server hosted on [Railway](https://railway.app/) or [Fly.io](https://fly.io/) (free tier), tracking the `release` branch
- **CI/CD**: GitHub Actions - PRs build and test only; merges/pushes to the `release` branch build, test, and deploy the client to GitHub Pages. Merge `main` → `release` when ready to demo.

## 1) Deploy the Signaling Server

You need a persistent WebSocket server reachable over `wss://`. Recommended hosts: Railway (easiest) or Fly.io.

### Railway (Recommended)

1. Sign up at [railway.app](https://railway.app/) and connect your GitHub account.
2. Create a new project → Deploy from GitHub repo → select this repo.
3. Set the root/service to deploy the `server/` directory (set **Root Directory** to `server/`).
4. In the service settings → Source, set the **branch to track** to `release` (so it auto-deploys only when you merge to `release`).
5. Railway will auto-detect Node, but set the start command if needed:
   - Build: `npm run build` (or let it run)
   - Start: `npm run start` (runs `node dist/index.js`)
6. Railway will provide a public domain (e.g. `your-app.up.railway.app`). Use `wss://your-app.up.railway.app`.
7. Ensure the server listens on `process.env.PORT` (it does via the fix in `server/src/index.ts`).

### Fly.io (Alternative)

1. Install [flyctl](https://fly.io/docs/hands-on/install-flyctl/), sign up, and login.
2. From `server/`, run `fly launch` to create an app.
3. Set the internal port to match your server (8080) and configure to listen on `0.0.0.0:$PORT`.
4. Deploy with `fly deploy`. You'll get a `*.fly.dev` domain with HTTPS/WSS.

> Note: Render's free tier spins down on inactivity and can break WebSocket connections; avoid for this demo.

## 2) Configure the Client for the Deployed Server

The client needs to know where the signaling server is in production.

### Update SignalingClient

In `client/src/network/SignalingClient.ts`, read from Vite env:

```ts
constructor(url: string = import.meta.env.VITE_SIGNALING_URL ?? 'ws://localhost:8080') {
  this.url = url;
}
```

### Update Vite Config for GitHub Pages

In `client/vite.config.ts`, set the base path to your repo name:

```ts
export default defineConfig({
  base: '/trench-heresy/', // replace with your repo name
  // ...
})
```

For local development, leave the env var unset to use `ws://localhost:8080`.

## 3) Set Up GitHub Pages

1. Go to your repo → Settings → Pages
2. Source: **GitHub Actions**
3. Save

## 4) Create GitHub Actions Workflows

Add the following workflows to `.github/workflows/`.

### `.github/workflows/ci.yml` (PR checks - build + test, no deploy)

```yaml
name: CI

on:
  pull_request:
    branches: [ master, main ]

jobs:
  build-and-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run build --workspaces --if-present
      - run: npm test --workspaces --if-present
```

### `.github/workflows/deploy.yml` (Release branches - build + test + deploy)

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches:
      - 'release'

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: 'pages'
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run build --workspaces --if-present
      - run: npm test --workspaces --if-present
      - name: Build client for Pages
        run: npm run build --workspace=client
        env:
          VITE_SIGNALING_URL: ${{ secrets.VITE_SIGNALING_URL }}
      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: ./client/dist

  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    needs: build
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

## 5) Add Secrets

In your repo → Settings → Secrets and variables → Actions, add:
- `VITE_SIGNALING_URL` = `wss://your-server-domain` (from Railway/Fly.io)

## 6) Deploy

1. Push the workflows and client config changes.
2. When ready to demo, merge `main` into `release` and push: `git checkout release && git merge main && git push`
3. Railway will auto-deploy the server from `release`. GitHub Actions will build, test, and deploy the client to GitHub Pages from `release`. Check the Actions tab for progress.
4. Once deployed, visit `https://<username>.github.io/<repo-name>/`
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
