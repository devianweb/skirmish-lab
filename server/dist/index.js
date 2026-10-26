"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const SignalingServer_1 = require("./SignalingServer");
const PORT = process.env.PORT ? parseInt(process.env.PORT) : 8080;
const server = new SignalingServer_1.SignalingServer(PORT);
// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down signaling server...');
    server.close();
    process.exit(0);
});
process.on('SIGTERM', () => {
    console.log('\nShutting down signaling server...');
    server.close();
    process.exit(0);
});
