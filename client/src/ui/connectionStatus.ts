export const WAKE_UP_NOTICE_DELAY_MS = 1500;
export const FIRST_CONNECT_RETRY_DELAY_MS = 3000;
export const FIRST_CONNECT_GIVE_UP_MS = 60000;
export const ROOM_REQUEST_SLOW_DELAY_MS = 10000;
export const ROOM_REQUEST_TIMEOUT_MS = 60000;

export const WAKING_UP_TEXT = 'Waking up the server, this can take up to a minute…';
export const CONNECT_FAILED_TEXT = "Couldn't reach the game server. Check your connection, then try again.";
export const CREATING_ROOM_TEXT = 'Creating room…';
export const JOINING_ROOM_TEXT = 'Joining room…';
export const STILL_WAKING_UP_SUFFIX = ' — the server is still waking up';
export const ROOM_REQUEST_TIMEOUT_TEXT = "The server didn't answer. Try again.";

export type ConnectionPhase = 'idle' | 'connecting-quiet' | 'connecting-slow' | 'connected' | 'failed';
export type RoomRequestPhase = 'none' | 'creating' | 'creating-slow' | 'joining' | 'joining-slow' | 'timed-out';

export interface LobbyConnectionState {
  connection: ConnectionPhase;
  roomRequest: RoomRequestPhase;
}

export interface ConnectionStatusView {
  buttonsDisabled: boolean;
  text: string;
  spinner: boolean;
  showRetry: boolean;
}

export function createInitialConnectionState(): LobbyConnectionState {
  return {
    connection: 'idle',
    roomRequest: 'none',
  };
}

export function getConnectionStatusView(state: LobbyConnectionState): ConnectionStatusView {
  switch (state.connection) {
    case 'connecting-quiet':
      return { buttonsDisabled: true, text: '', spinner: false, showRetry: false };
    case 'connecting-slow':
      return { buttonsDisabled: true, text: WAKING_UP_TEXT, spinner: true, showRetry: false };
    case 'failed':
      return { buttonsDisabled: true, text: CONNECT_FAILED_TEXT, spinner: false, showRetry: true };
    case 'idle':
    case 'connected':
      switch (state.roomRequest) {
        case 'creating':
          return { buttonsDisabled: true, text: CREATING_ROOM_TEXT, spinner: true, showRetry: false };
        case 'creating-slow':
          return {
            buttonsDisabled: true,
            text: `${CREATING_ROOM_TEXT}${STILL_WAKING_UP_SUFFIX}`,
            spinner: true,
            showRetry: false,
          };
        case 'joining':
          return { buttonsDisabled: true, text: JOINING_ROOM_TEXT, spinner: true, showRetry: false };
        case 'joining-slow':
          return {
            buttonsDisabled: true,
            text: `${JOINING_ROOM_TEXT}${STILL_WAKING_UP_SUFFIX}`,
            spinner: true,
            showRetry: false,
          };
        case 'timed-out':
          return { buttonsDisabled: false, text: ROOM_REQUEST_TIMEOUT_TEXT, spinner: false, showRetry: false };
        case 'none':
        default:
          return { buttonsDisabled: false, text: '', spinner: false, showRetry: false };
      }
  }
}
