# Deployment Guide

This guide covers deploying the SkirmishLab demo using **GitHub Pages** (for the client) and **Azure App Service** (for the WebSocket signaling server).

## Overview

- **Client**: Static Vite app hosted on GitHub Pages
- **Signaling Server**: Node.js WebSocket server hosted on [Azure App Service](https://portal.azure.com/) (Linux, Node 20 LTS, Free `F1` tier)
- **CI/CD**: GitHub Actions — PRs to `master` build and test only; a **merged PR into the `release` branch** builds, tests, packages, and deploys both the client to GitHub Pages and the signaling server to Azure App Service. Open a PR (`master` → `release`) when ready to demo.

## 1) Deploy the Signaling Server (Azure App Service)

You need a persistent WebSocket server reachable over `wss://`. Azure App Service provides a Free (`F1`) Linux tier that runs Node 20 LTS with automatic TLS termination (`wss://<app-name>.azurewebsites.net`).

### Step 1: Create an Azure Account & Subscription
1. Go to [azure.microsoft.com/free](https://azure.microsoft.com/free/) and click **Try Azure for free** (or **Pay as you go** — the App Service **Free `F1`** tier costs **$0/month** on either subscription type).
2. Sign in with your Microsoft / GitHub account and complete phone + card verification.
3. Open the [Azure Portal](https://portal.azure.com/).

### Step 2: Create the Azure Web App (Portal UI)
1. In the Azure Portal search bar, search for **App Services** and click **Create** → **Web App**.
2. On the **Basics** tab:
   - **Subscription**: Your Azure subscription.
   - **Resource Group**: Click **Create new** → enter `rg-skirmish-lab`.
   - **Name**: Enter a unique name, e.g. `skirmish-lab-signaling` *(your WebSocket URL will be `wss://<name>.azurewebsites.net`)*.
   - **Publish**: `Code`
   - **Runtime stack**: `Node 20 LTS`
   - **Operating System**: `Linux`
   - **Region**: Pick the region closest to you (e.g. `UK South` or `West Europe`).
   - **Pricing plan**: Click **Change size** (or **Explore pricing plans**) → select **Free F1** ($0/month, 60 CPU mins/day, 1 GB RAM).
3. Click **Review + create**, then **Create**, and once deployed click **Go to resource**.

### Step 3: Configure Startup Command & SCM Basic Auth
Inside your new Web App in the Azure Portal:
1. In the left sidebar, expand **Settings** → click **Configuration** → **General settings** tab:
   - **Startup Command**: `npm start`
   - **SCM Basic Auth Publishing Credentials**: **On** *(required so Azure allows downloading the Publish Profile)*
   - **FTP Basic Auth Publishing Credentials**: **Off** (not needed)
2. Click **Save** at the top and confirm **Continue**.

*(Note: On Linux App Service, WebSockets are enabled automatically by the front-end load balancer, and HTTP health probes to `/` or `/healthz` receive `200 OK` from the server.)*

### Step 4: Download the Publish Profile
1. In the left sidebar of your Web App, click **Overview**.
2. In the top toolbar, click **Download publish profile** (saves a `<app-name>.PublishSettings` XML file to your computer).

### Step 5: Add GitHub Repository Secrets
In your GitHub repo → **Settings** → **Secrets and variables** → **Actions**, add:
- `AZURE_WEBAPP_NAME`: `skirmish-lab-signaling` *(or the exact name you gave the Web App)*
- `AZURE_WEBAPP_PUBLISH_PROFILE`: The full XML content of the downloaded `.PublishSettings` file
- `VITE_SIGNALING_URL`: `wss://<app-name>.azurewebsites.net` *(use `wss://`, no trailing slash)*

## 2) Configure the Client for the Deployed Server

Already implemented in the repo:

- `client/src/network/SignalingClient.ts` defaults its URL to `import.meta.env.VITE_SIGNALING_URL ?? 'ws://localhost:8080'`.
- `client/vite.config.ts` sets `base: '/skirmish-lab/'` for GitHub Pages.
- `client/src/vite-env.d.ts` declares the `VITE_SIGNALING_URL` type.

For local development, leave the env var unset to use `ws://localhost:8080`.

## 3) Set Up GitHub Pages

1. Go to your repo → **Settings** → **Pages**
2. Under **Build and deployment** → **Source**, select **GitHub Actions**
3. Save

## 4) GitHub Actions Workflows

Both workflows live in `.github/workflows/`:

- **`.github/workflows/ci.yml`** — PR checks: triggers on PRs to `master` (and pushes to `master`). Runs `npm ci`, builds all workspaces, and runs all workspace tests. **Never deploys.**
- **`.github/workflows/deploy.yml`** — release deploys: triggers on pushes to the `release` branch (e.g. when a PR targeting `release` is merged). Checks out the release commit, builds and tests everything, packages a self-contained server bundle for Azure App Service (`deploy-server/`), builds the client with `VITE_SIGNALING_URL`, and deploys:
  1. `deploy-pages`: Deploys `client/dist` to GitHub Pages.
  2. `deploy-server`: Deploys `deploy-server/` to Azure App Service using `azure/webapps-deploy@v3` (runs when `AZURE_WEBAPP_PUBLISH_PROFILE` is set).

## 5) Release Flow

1. Create the `release` branch once if not already created: `git push origin master:release`.
2. When ready to release, open a PR with base `release` and compare `master` (New Pull Request → base: `release`, compare: `master`).
3. Merge the PR.
4. GitHub Actions will build, test, and deploy both the client to GitHub Pages and the signaling server to Azure App Service.
5. Visit `https://devianweb.github.io/skirmish-lab/` to demo live peer-to-peer skirmishes.

## Troubleshooting

| Issue | Fix |
|---|---|
| Client can't connect to server | Ensure `VITE_SIGNALING_URL` is set in the deploy workflow secret and uses `wss://`. Check CORS/firewall not blocking WebSocket connections. |
| Assets fail to load on Pages | Verify `base` in `client/vite.config.ts` matches your repo name. |
| Server cold start delays | Free hosts may sleep; first connection can take a few seconds. Retry if needed. |
| Mixed content errors | GitHub Pages is HTTPS, so the server must be reachable over WSS. |
| Deploys from direct pushes | By design: only merged PRs into `release` deploy. If a push to `release` deployed the server (Railway) but not the client (Pages), re-sync via a PR. |

## Notes

- After WebRTC connects, the signaling server is no longer needed for game traffic (per architecture).
- Rooms are ephemeral and cleaned up by the server.
- This is intended for demos/friends - not hardened for public internet scale.
