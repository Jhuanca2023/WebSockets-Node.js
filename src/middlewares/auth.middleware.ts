import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User';
import Room from '../models/Room';

const JWT_SECRET = process.env.JWT_SECRET || 'secret';

export const authMiddleware = async (req: any, res: Response, next: NextFunction) => {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
        return res.status(401).json({ message: 'No token, authorization denied' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        req.user = decoded;
        next();
    } catch (err) {
        res.status(401).json({ message: 'Token is not valid' });
    }
};

export const isAdmin = (req: any, res: Response, next: NextFunction) => {
    if (req.user && req.user.role === 'ADMIN') {
        next();
    } else {
        res.status(403).json({ message: 'Access denied: Requires Admin role' });
    }
};

export const isRoomHost = async (req: any, res: Response, next: NextFunction) => {
    try {
        const { roomId } = req.params;
        const room = await Room.findById(roomId);

        if (!room) {
            return res.status(404).json({ message: 'Room not found' });
        }

        if (room.hostId.toString() === req.user.id || req.user.role === 'ADMIN') {
            next();
        } else {
            res.status(403).json({ message: 'Access denied: Only the Host or Admin can perform this action' });
        }
    } catch (error) {
        res.status(500).json({ message: 'Server error in host validation' });
    }
};
