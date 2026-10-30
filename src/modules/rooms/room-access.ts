import mongoose from 'mongoose';
import Room from '../../models/Room';
import Membership from '../../models/Membership';

export interface AccessRoom {
    _id: unknown;
    hostId: unknown;
    isPrivate?: boolean;
    inheritAccess?: boolean;
    parentRoomId?: unknown;
    authorizedUsers?: unknown[];
}

export const isResourceId = (value: unknown): value is string =>
    typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);

export const roomOwnerId = (room: AccessRoom): string => {
    const host = room.hostId as { _id?: unknown } | null;
    return String(host?._id ?? room.hostId);
};

// Sub-rooms retain their explicit ACL, even when isPrivate is false.
export function allowsRoom(room: AccessRoom, userId: string, parent?: AccessRoom): boolean {
    if (room.parentRoomId && !parent) return false;
    return roomOwnerId(room) === userId ||
        !!room.authorizedUsers?.some(id => String(id) === userId) ||
        (!!parent && roomOwnerId(parent) === userId);
}

export async function canAccessRoom(room: AccessRoom, userId: string, visited = new Set<string>()): Promise<boolean> {
    const id = String(room._id);
    if (visited.has(id) || visited.size >= 8) return false;
    visited.add(id);
    if (!room.parentRoomId) return allowsRoom(room, userId) ||
        !!await Membership.exists({ roomId: id, userId });
    const parent = await Room.findById(room.parentRoomId);
    if (!parent || !await canAccessRoom(parent, userId, visited)) return false;
    return room.inheritAccess === true || allowsRoom(room, userId, parent) || !!await Membership.exists({ roomId: id, userId });
}

export function messageVisibility(userId: string) {
    const id = new mongoose.Types.ObjectId(userId);
    return { $or: [{ recipientId: null }, { userId: id }, { recipientId: id }] };
}

export function canReadMessage(message: { userId: unknown; recipientId?: unknown }, userId: string): boolean {
    return !message.recipientId || String(message.userId) === userId || String(message.recipientId) === userId;
}
