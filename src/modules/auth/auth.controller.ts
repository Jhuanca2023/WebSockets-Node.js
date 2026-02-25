import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../../models/User';

const JWT_SECRET = process.env.JWT_SECRET || 'secret';
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'refresh_secret';

export const register = async (req: Request, res: Response) => {
    try {
        const { name, email, password } = req.body;

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: 'El usuario ya existe' });
        }

        const hashedPassword = await bcrypt.hash(password, 12);
        const user = new User({ name, email, password: hashedPassword });
        await user.save();

        res.status(201).json({ message: 'Usuario registrado con éxito' });
    } catch (error) {
        res.status(500).json({ message: 'Error en el servidor', error });
    }
};

export const login = async (req: Request, res: Response) => {
    try {
        const { email, password } = req.body;

        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ message: 'Credenciales inválidas' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(400).json({ message: 'Credenciales inválidas' });
        }

        const accessToken = jwt.sign(
            { id: user._id, role: user.role },
            JWT_SECRET,
            { expiresIn: (process.env.JWT_EXPIRES_IN || '1h') as any }
        );

        const refreshToken = jwt.sign(
            { id: user._id },
            JWT_REFRESH_SECRET,
            { expiresIn: (process.env.JWT_REFRESH_EXPIRES_IN || '7d') as any }
        );

        res.json({
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                profileImage: user.profileImage
            },
            accessToken,
            refreshToken
        });
    } catch (error) {
        res.status(500).json({ message: 'Error en el servidor', error });
    }
};

export const updateProfile = async (req: Request, res: Response) => {
    try {
        const authReq = req as any;
        const userId = authReq.user.id;
        const { profileImage } = req.body;

        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });

        user.profileImage = profileImage;
        await user.save();

        res.json({
            message: 'Perfil actualizado',
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                profileImage: user.profileImage
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Error al actualizar perfil', error });
    }
};
