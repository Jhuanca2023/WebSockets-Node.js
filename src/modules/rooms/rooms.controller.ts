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
        const room = await Room.findById(req.params.id).populate('hostId', 'name');
        if (!room) return res.status(404).json({ message: 'Sala no encontrada' });
        res.json(room);
    } catch (error) {
        res.status(500).json({ message: 'Error al obtener la sala', error });
    }
};
