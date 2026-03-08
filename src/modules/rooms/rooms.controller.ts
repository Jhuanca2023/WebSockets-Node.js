import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import Room from '../../models/Room';
import Message from '../../models/Message';

export const createRoom = async (req: AuthRequest, res: Response) => {
    try {
        const { name, description, isPrivate, maxUsers, imageUrl, parentRoomId } = req.body;
        const hostId = req.user.id;

        const code = Math.random().toString(36).substring(2, 8).toUpperCase();

        const room = new Room({
            name,
            description,
            hostId,
            isPrivate,
            maxUsers,
            imageUrl,
            parentRoomId,
            code: isPrivate ? code : undefined
        });

        await room.save();
        res.status(201).json(room);
    } catch (error) {
        res.status(500).json({ message: 'Error al crear la sala', error });
    }
};

export const getRooms = async (req: AuthRequest, res: Response) => {
    try {
        const userId = req.user.id;
        const rooms = await Room.find({
            $or: [
                { isPrivate: false },
                { hostId: userId },
                { authorizedUsers: userId }
            ]
        }).populate('hostId', 'name profileImage email');
        res.json(rooms);
    } catch (error) {
        res.status(500).json({ message: 'Error al obtener las salas', error });
    }
};

export const getRoomMessages = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const userId = req.user.id;

        const room = await Room.findById(id);
        if (!room) return res.status(404).json({ message: 'Sala no encontrada' });

        if (room.parentRoomId) {
            const authorized = room.authorizedUsers?.some((uid: any) => String(uid) === String(userId));
            const isSubRoomHost = String(room.hostId) === String(userId);

            let isParentHost = false;
            if (room.parentRoomId) {
                const parent = await Room.findById(room.parentRoomId).select('hostId').lean();
                if (parent) {
                    isParentHost = String(parent.hostId) === String(userId);
                }
            }

            if (!isSubRoomHost && !isParentHost && !authorized) {
                return res.status(403).json({ message: 'No tienes permisos para ver los mensajes de esta sub-sala' });
            }
        }

        const messages = await Message.find({ roomId: id })
            .sort({ createdAt: 1 })
            .limit(500);

        res.json(messages);
    } catch (error) {
        res.status(500).json({ message: 'Error al obtener mensajes', error });
    }
};

export const getRoomById = async (req: AuthRequest, res: Response) => {
    try {
        const room = await Room.findById(req.params.id).populate('hostId', '_id name profileImage');
        if (!room) return res.status(404).json({ message: 'Sala no encontrada' });
        res.json(room);
    } catch (error) {
        res.status(500).json({ message: 'Error al obtener la sala', error });
    }
};

export const updateRoom = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const { name, description, isPrivate, authorizedUsers } = req.body;
        const hostId = req.user.id;

        const room = await Room.findById(id);
        if (!room) return res.status(404).json({ message: 'Sala no encontrada' });

        if (room.hostId.toString() !== hostId) {
            return res.status(403).json({ message: 'No tienes permisos para modificar esta sala' });
        }

        room.name = name || room.name;
        room.description = description || room.description;
        room.isPrivate = isPrivate !== undefined ? isPrivate : room.isPrivate;
        if (authorizedUsers) room.authorizedUsers = authorizedUsers;

        await room.save();
        res.json(room);
    } catch (error) {
        res.status(500).json({ message: 'Error al actualizar la sala', error });
    }
};

export const deleteRoom = async (req: AuthRequest, res: Response) => {
    try {
        const { id } = req.params;
        const hostId = req.user.id;

        const room = await Room.findById(id);
        if (!room) return res.status(404).json({ message: 'Sala no encontrada' });

        if (room.hostId.toString() !== hostId) {
            return res.status(403).json({ message: 'No tienes permisos para eliminar esta sala' });
        }

        await Room.findByIdAndDelete(id);
        res.json({ message: 'Sala eliminada con éxito' });
    } catch (error) {
        res.status(500).json({ message: 'Error al eliminar la sala', error });
    }
};
