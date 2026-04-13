import { io, Socket } from 'socket.io-client';
import type {
  DashboardConfigPayload,
  DashboardRequestPayload,
  DashboardSubscribedPayload,
  DashboardUpdatePayload,
} from '../types/dashboard';

interface ServerToClientEvents {
  'dashboard:update': (payload: DashboardUpdatePayload) => void;
  'dashboard:config': (payload: DashboardConfigPayload) => void;
  'dashboard:subscribed': (payload: DashboardSubscribedPayload) => void;
  'dashboard:unsubscribed': () => void;
}

interface ClientToServerEvents {
  'dashboard:request': (payload?: DashboardRequestPayload) => void;
  'dashboard:subscribe': (payload?: { intervalMs?: number }) => void;
  'dashboard:config:request': () => void;
  'dashboard:unsubscribe': () => void;
}

const SOCKET_URL = 'http://39.105.171.44:8800';

let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

export function getSocket(): Socket<ServerToClientEvents, ClientToServerEvents> {
  if (!socket) {
    socket = io(SOCKET_URL, {
      transports: ['websocket'],
      autoConnect: true,
    });
  }
  return socket;
}
