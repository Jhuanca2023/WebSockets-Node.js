import { Response, NextFunction } from 'express';
import Room from '../models/Room';
import { AuthRequest, authMiddleware, adminMiddleware } from './auth';
import { isResourceId } from '../modules/rooms/room-access';
export { authMiddleware };
export const isAdmin = adminMiddleware;
export const isRoomHost = async (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!isResourceId(req.params.roomId)) return res.status(400).json({ message: 'ID de sala inválido' });
    try {
        const room = await Room.findById(req.params.roomId);
        if (!room) return res.status(404).json({ message: 'Sala no encontrada' });
        if (String(room.hostId) !== req.user?.id && req.user?.role !== 'ADMIN') {
            return res.status(403).json({ message: 'No tienes permisos para administrar esta sala' });
        }
        next();
    } catch {
        res.status(500).json({ message: 'Error al validar permisos' });
    }
};
