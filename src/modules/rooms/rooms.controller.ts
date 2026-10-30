import { Response } from 'express';
import { randomBytes } from 'crypto';
import { AuthRequest } from '../../middlewares/auth';
import Room from '../../models/Room';
import Message from '../../models/Message';
import Membership from '../../models/Membership';
import { canAccessRoom, isResourceId, messageVisibility } from './room-access';

const invalidId = (res: Response) => res.status(400).json({ message: 'ID de sala inválido' });

export const createRoom = async (req: AuthRequest, res: Response) => {
    try {
        const { name, description, isPrivate, maxUsers, imageUrl, parentRoomId, communityType, channelType, inheritAccess } = req.body;
        if ((inheritAccess !== undefined && typeof inheritAccess !== 'boolean') || typeof name !== 'string' || !name.trim() || name.length > 100 ||
            (description !== undefined && (typeof description !== 'string' || description.length > 2000)) ||
            (isPrivate !== undefined && typeof isPrivate !== 'boolean') ||
            (communityType !== undefined && !['friends', 'gaming', 'creators'].includes(communityType)) ||
            (channelType !== undefined && !['text', 'voice', 'forum'].includes(channelType)) ||
            (maxUsers !== undefined && (!Number.isInteger(maxUsers) || maxUsers < 1 || maxUsers > 1000))) {
            return res.status(400).json({ message: 'Datos de sala inválidos' });
        }
        if (parentRoomId) {
            if (!isResourceId(parentRoomId)) return invalidId(res);
            const parent = await Room.findById(parentRoomId);
            if (!parent) return res.status(404).json({ message: 'Sala principal no encontrada' });
            if (String(parent.hostId) !== req.user.id || parent.parentRoomId || parent.kind === 'direct' || parent.archived) {
                return res.status(403).json({ message: 'Solo el propietario puede crear sub-salas en su sala principal' });
            }
        }
        const room = await Room.create({
            name: name.trim(), description, isPrivate: isPrivate ?? true, maxUsers, imageUrl, communityType, channelType: channelType ?? 'text',
            inheritAccess: inheritAccess === true, hostId: req.user.id, parentRoomId: parentRoomId || undefined,
            ...(isPrivate ? { code: randomBytes(16).toString('hex') } : {})
        });
        return res.status(201).json(room);
    } catch {
        return res.status(500).json({ message: 'Error al crear la sala' });
    }
};

export const getRooms = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user.id;
        const memberships = await Membership.find({ userId }).select('roomId');
        const rootIds = memberships.map(item => item.roomId);
        const owned = await Room.find({ $or: [{ hostId: userId }, { authorizedUsers: userId }] }).select('_id');
        const rooms = await Room.find({ $or: [
            { _id: { $in: rootIds } }, { hostId: userId }, { authorizedUsers: userId },
            { parentRoomId: { $in: [...rootIds, ...owned.map(room => room._id)] } }
        ] }).populate('hostId', 'name profileImage');
        const access = await Promise.all(rooms.map(room => canAccessRoom(room, userId)));
        return res.json(rooms.filter((_, index) => access[index]));
    } catch {
        return res.status(500).json({ message: 'Error al obtener las salas' });
    }
};

export const getRoomMessages = async (req: AuthRequest, res: Response) => {
    try {
        const id = req.params.id;
        if (!isResourceId(id)) return invalidId(res);
        const room = await Room.findById(id);
        if (!room) return res.status(404).json({ message: 'Sala no encontrada' });
        if (!await canAccessRoom(room, req.user.id)) {
            return res.status(403).json({ message: 'No tienes permisos para ver esta sala' });
        }
        const before = req.query.before;
        if (before !== undefined && !isResourceId(before)) return invalidId(res);
        const messages = await Message.find({
            roomId: id, ...messageVisibility(req.user.id),
            ...(before ? { _id: { $lt: before } } : {})
        }).sort({ _id: -1 }).limit(500);
        return res.json(messages.reverse());
    } catch {
        return res.status(500).json({ message: 'Error al obtener mensajes' });
    }
};

export const getRoomById = async (req: AuthRequest, res: Response) => {
    try {
        if (!isResourceId(req.params.id)) return invalidId(res);
        const room = await Room.findById(req.params.id).populate('hostId', '_id name profileImage');
        if (!room) return res.status(404).json({ message: 'Sala no encontrada' });
        if (!await canAccessRoom(room, req.user.id)) {
            return res.status(403).json({ message: 'No tienes permisos para ver esta sala' });
        }
        return res.json(room);
    } catch {
        return res.status(500).json({ message: 'Error al obtener la sala' });
    }
};

export const updateRoom = async (req: AuthRequest, res: Response) => {
    try {
        if (!isResourceId(req.params.id)) return invalidId(res);
        const room = await Room.findById(req.params.id);
        if (!room) return res.status(404).json({ message: 'Sala no encontrada' });
        if (room.kind === 'direct' || String(room.hostId) !== req.user.id) {
            return res.status(403).json({ message: 'No tienes permisos para modificar esta sala' });
        }
        const { name, description, isPrivate, authorizedUsers, permissions, archived, inheritAccess } = req.body;
        const permissionKeys = ['sendMessages', 'sendAudio', 'sendFiles', 'shareScreen'];
        if ((archived !== undefined && typeof archived !== 'boolean') ||
            (inheritAccess !== undefined && typeof inheritAccess !== 'boolean') ||
            (permissions !== undefined && (!permissions || typeof permissions !== 'object' || Array.isArray(permissions) ||
                Object.entries(permissions).some(([key, value]) => !permissionKeys.includes(key) || typeof value !== 'boolean')))) {
            return res.status(400).json({ message: 'Permisos inválidos' });
        }
        if ((name !== undefined && (typeof name !== 'string' || !name.trim() || name.length > 100)) ||
            (description !== undefined && (typeof description !== 'string' || description.length > 2000)) ||
            (isPrivate !== undefined && typeof isPrivate !== 'boolean') ||
            (authorizedUsers !== undefined && (!Array.isArray(authorizedUsers) || authorizedUsers.length > 1000 ||
                !authorizedUsers.every(isResourceId)))) {
            return res.status(400).json({ message: 'Datos de sala inválidos' });
        }
        if (name !== undefined) room.name = name.trim();
        if (description !== undefined) room.description = description;
        if (isPrivate !== undefined) {
            room.isPrivate = isPrivate;
            if (isPrivate && !room.code) room.code = randomBytes(16).toString('hex');
        }
        if (authorizedUsers !== undefined) room.authorizedUsers = authorizedUsers;
        if (permissions !== undefined) room.set('permissions', { ...room.toObject().permissions, ...permissions });
        if (archived !== undefined) room.archived = archived;
        if (inheritAccess !== undefined && room.parentRoomId) room.inheritAccess = inheritAccess;
        await room.save();
        req.app.get('io')?.to(String(room._id)).emit('room-updated', { roomId: String(room._id) });
        if (!room.parentRoomId) {
            const children = await Room.find({ parentRoomId: room._id }).select('_id');
            for (const child of children) req.app.get('io')?.to(String(child._id)).emit('room-updated', { roomId: String(child._id) });
        }
        return res.json(room);
    } catch {
        return res.status(500).json({ message: 'Error al actualizar la sala' });
    }
};

export const deleteRoom = async (req: AuthRequest, res: Response) => {
    try {
        if (!isResourceId(req.params.id)) return invalidId(res);
        const room = await Room.findById(req.params.id);
        if (!room) return res.status(404).json({ message: 'Sala no encontrada' });
        if (String(room.hostId) !== req.user.id) {
            return res.status(403).json({ message: 'No tienes permisos para eliminar esta sala' });
        }
        // Avoid orphaning child rooms until lifecycle cleanup is implemented.
        if (await Room.exists({ parentRoomId: room._id })) {
            return res.status(409).json({ message: 'Elimina primero las sub-salas' });
        }
        await Room.findByIdAndDelete(room._id);
        return res.json({ message: 'Sala eliminada con éxito' });
    } catch {
        return res.status(500).json({ message: 'Error al eliminar la sala' });
    }
};
