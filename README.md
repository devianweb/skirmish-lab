# SkirmishLab

[![CI](https://github.com/devianweb/skirmish-lab/actions/workflows/ci.yml/badge.svg)](https://github.com/devianweb/skirmish-lab/actions/workflows/ci.yml)
[![Deploy](https://github.com/devianweb/skirmish-lab/actions/workflows/deploy.yml/badge.svg)](https://github.com/devianweb/skirmish-lab/actions/workflows/deploy.yml)

An unofficial, unendorsed tabletop skirmish simulator for [One Page Rules](https://onepagerules.com/) games, built with TypeScript and Three.js. Two players connect via peer-to-peer WebRTC using invite codes for direct play.

**Currently targeting:** Grimdark Future: Firefight. Age of Fantasy: Skirmish support is planned (the engine is ruleset-agnostic — rulesets are data packs).

> SkirmishLab is a fan-made community project. It is not affiliated with, endorsed by, or sponsored by One Page Rules. All game mechanics are implemented from first principles; no third-party rulebook text or artwork is bundled.

## Tech Stack

- **Frontend:** TypeScript, Three.js, Vite
- **Backend:** Node.js, TypeScript, WebSocket (ws)
- **Networking:** WebRTC data channels for P2P gameplay, custom signaling server
- **Target:** Desktop browsers only

## Features

- Host-authoritative turn-based gameplay
- Alternating activation skirmish flow (in development)
- Direct play via XXX-XXX invite codes (no matchmaking)
- Server-rolled dice for fair play
- 3D battlefield rendering with controllable cameras
- Ruleset-agnostic engine — armies and rules are data, not code
- Low-poly art style with original assets

## Getting Started

### Prerequisites

- Node.js LTS (installed via nvm)
- npm

### Installation

```bash
npm install
```

### Development

```bash
# Run both client and server
npm run dev

# Run server only
npm run dev:server

# Run client only
npm run dev:client
```

- Client runs on http://localhost:3000
- Signaling server runs on ws://localhost:8080

### Testing

```bash
npm test
```

## Project Structure

```
skirmish-lab/
├── client/     # Three.js frontend (Vite)
├── server/     # WebSocket signaling server
├── shared/     # Shared types, game state, and rules
└── doc/        # Design documents (GDD, Architecture, etc.)
```

## CI/CD & Deployment

- **PR Checks**: Pull requests run build and tests across all workspaces (no deployment).
- **Demos**: Only a **merged PR into the `release` branch** triggers deployment. The client deploys to [GitHub Pages](https://pages.github.com/), and the signaling server (deployed to Railway/Fly.io) auto-deploys from the `release` branch over WSS.
- **Release Flow**: Open a PR (`master` → `release`) and merge it when ready to demo/show off. Direct pushes to `release` never deploy the client.

See [doc/DEPLOYMENT.md](doc/DEPLOYMENT.md) for setup instructions.

## Documentation

See the `doc/` folder for detailed documentation:
- [GDD.md](doc/GDD.md) - Game design document
- [ARCHITECTURE.md](doc/ARCHITECTURE.md) - Technical architecture
- [NETWORKING.md](doc/NETWORKING.md) - WebRTC and signaling protocol
- [DATA_MODEL.md](doc/DATA_MODEL.md) - Game state schema
- [SYSTEMS.md](doc/SYSTEMS.md) - Game rules and systems
- [ROADMAP.md](doc/ROADMAP.md) - Development roadmap
- [DEPLOYMENT.md](doc/DEPLOYMENT.md) - Deployment and CI/CD guide

## License

TBD
