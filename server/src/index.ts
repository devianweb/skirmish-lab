import { SignalingServer } from './SignalingServer';

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 8080;
const server = new SignalingServer(PORT);

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

