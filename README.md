# Trench Heresy

A browser-based 3D version of Trench Crusade built with TypeScript and Three.js. Two players can connect via peer-to-peer WebRTC using invite codes for direct play.

## Tech Stack

- **Frontend:** TypeScript, Three.js, Vite
- **Backend:** Node.js, TypeScript, WebSocket (ws)
- **Networking:** WebRTC data channels for P2P gameplay, custom signaling server
- **Target:** Desktop browsers only

## Features

- Host-authoritative turn-based gameplay
- Direct play via XXX-XXX invite codes (no matchmaking)
- Server-rolled dice for fair play
- 3D battlefield rendering with controllable cameras
- Follows Trench Crusade rules as closely as possible
- Low-poly art style

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
cd server
npm test
```

## Project Structure

```
trench-heresy/
├── client/     # Three.js frontend (Vite)
├── server/     # WebSocket signaling server
├── shared/     # Shared TypeScript types
└── doc/        # Design documents (GDD, Architecture, etc.)
```

## Documentation

See the `doc/` folder for detailed documentation:
- [GDD.md](doc/GDD.md) - Game design document
- [ARCHITECTURE.md](doc/ARCHITECTURE.md) - Technical architecture
- [NETWORKING.md](doc/NETWORKING.md) - WebRTC and signaling protocol
- [DATA_MODEL.md](doc/DATA_MODEL.md) - Game state schema
- [SYSTEMS.md](doc/SYSTEMS.md) - Game rules and systems
- [ROADMAP.md](doc/ROADMAP.md) - Development roadmap

## License

TBD
