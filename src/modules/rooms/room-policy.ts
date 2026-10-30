import Room from '../../models/Room';
import { roomOwnerId } from './room-access';

export async function canPerform(room: any, userId: string, permission: string): Promise<boolean> {
    const parent = room.parentRoomId ? await Room.findById(room.parentRoomId) : null;
    if (room.archived || parent?.archived) return false;
    if (roomOwnerId(room) === userId && room.kind !== 'direct') return true;
    if (room.mutedUsers?.some((id: unknown) => String(id) === userId) || parent?.mutedUsers?.some(id => String(id) === userId)) return false;
    return room.permissions?.[permission] !== false && (parent?.permissions as any)?.[permission] !== false;
}
