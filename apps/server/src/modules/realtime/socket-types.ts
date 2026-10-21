import type { Socket } from "socket.io";

export interface SocketData {
  userId: string;
  displayName: string;
  roomId: string | null;
}

/**
 * Socket tipado solo en `data`. Los eventos se validan con Zod en runtime,
 * por lo que el mapa de eventos se deja abierto con firma segura.
 */
export type AppSocket = Socket & { data: SocketData };
