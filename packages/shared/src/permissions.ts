import type { RoomPermissions } from "./types.js";
import type { ControlMode, Role } from "./enums.js";

/**
 * Fuente única de verdad para los permisos derivados de (rol, modo de control).
 * El backend recalcula SIEMPRE estos permisos; el frontend solo los usa para
 * habilitar/deshabilitar UI. Nunca se confía en el cliente.
 */
export function computePermissions(
  role: Role,
  controlMode: ControlMode,
): RoomPermissions {
  const isHost = role === "HOST";
  const isDj = role === "DJ";
  const isParticipant = role === "PARTICIPANT";
  const isObserver = role === "OBSERVER";

  const canControlPlayback =
    isHost ||
    isDj ||
    (isParticipant && controlMode === "COLLABORATIVE");

  const canAddToQueue =
    isHost || isDj || ((isParticipant || isObserver) && controlMode !== "HOST_ONLY");

  const canRemoveFromQueue =
    isHost || isDj || (isParticipant && controlMode === "COLLABORATIVE");

  const canReorderQueue =
    isHost || isDj || (isParticipant && controlMode === "COLLABORATIVE");

  return {
    canManageRoom: isHost,
    canManageInvites: isHost,
    canManageMembers: isHost,
    canAddToQueue,
    canRemoveFromQueue,
    canReorderQueue,
    canControlPlayback: role === "OBSERVER" ? false : canControlPlayback,
  };
}
