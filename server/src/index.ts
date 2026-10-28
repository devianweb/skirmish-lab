import { SignalingServer } from './SignalingServer';

const port = process.env.PORT ? parseInt(process.env.PORT) : 8080;
new SignalingServer(port);
