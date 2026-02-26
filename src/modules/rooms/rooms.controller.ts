import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import Room from '../../models/Room';

export const createRoom = async (req: AuthRequest, res: Response) => {
    try {
        const { name, description, isPrivate, maxUsers } = req.body;
        const hostId = req.user.id;

        const code = Math.random().toString(36).substring(2, 8).toUpperCase();

        const room = new Room({
            name,
            description,
            hostId,
            isPrivate,
            maxUsers,
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
        const rooms = await Room.find({ isPrivate: false }).populate('hostId', 'name');
        res.json(rooms);
    } catch (error) {
        res.status(500).json({ message: 'Error al obtener las salas', error });
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
        const { name, description, isPrivate } = req.body;
        const hostId = req.user.id;

        const room = await Room.findById(id);
        if (!room) return res.status(404).json({ message: 'Sala no encontrada' });

        if (room.hostId.toString() !== hostId) {
            return res.status(403).json({ message: 'No tienes permisos para modificar esta sala' });
        }

        room.name = name || room.name;
        room.description = description || room.description;
        room.isPrivate = isPrivate !== undefined ? isPrivate : room.isPrivate;

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
