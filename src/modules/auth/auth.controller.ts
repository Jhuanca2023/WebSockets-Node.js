import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../../models/User';

import { JWT_SECRET, JWT_REFRESH_SECRET } from '../../config/security';

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
        if (!isMatch || user.isBanned) {
            return res.status(400).json({ message: 'Credenciales inválidas' });
        }

        const accessToken = jwt.sign(
            { id: user._id, role: user.role },
            JWT_SECRET,
            { expiresIn: (process.env.JWT_EXPIRES_IN || '8h') as any }
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
                profileImage: user.profileImage, username: user.username, bio: user.bio, status: user.status, statusText: user.statusText, bannerColor: user.bannerColor, createdAt: user.createdAt
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

        const { name, username, bio, status, statusText, bannerColor } = req.body;
        if ((name !== undefined && (typeof name !== 'string' || !name.trim() || name.length > 80)) ||
            (username !== undefined && (typeof username !== 'string' || !/^[a-z0-9_]{3,24}$/i.test(username))) ||
            (bio !== undefined && (typeof bio !== 'string' || bio.length > 400)) ||
            (statusText !== undefined && (typeof statusText !== 'string' || statusText.length > 80)) ||
            (status !== undefined && !['online', 'idle', 'dnd', 'invisible'].includes(status)) ||
            (bannerColor !== undefined && (typeof bannerColor !== 'string' || !/^#[0-9a-f]{6}$/i.test(bannerColor))) ||
            (profileImage != null && (typeof profileImage !== 'string' || profileImage.length > 1500000 || !/^(https?:\/\/|data:image\/(png|jpeg|webp);base64,)/i.test(profileImage)))) {
            return res.status(400).json({ message: 'Revisa los datos del perfil' });
        }
        if (name !== undefined) user.name = name.trim();
        if (username !== undefined) user.username = username.toLowerCase();
        if (bio !== undefined) user.bio = bio;
        if (status !== undefined) user.status = status;
        if (statusText !== undefined) user.statusText = statusText;
        if (bannerColor !== undefined) user.bannerColor = bannerColor;
        // Only update profileImage if it's provided
        if (profileImage !== undefined) {
            user.profileImage = profileImage;
        }
        await user.save();

        res.json({
            message: 'Perfil actualizado',
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                role: user.role,
                profileImage: user.profileImage, username: user.username, bio: user.bio, status: user.status, statusText: user.statusText, bannerColor: user.bannerColor, createdAt: user.createdAt
            }
        });
    } catch (error) {
        if ((error as any)?.code === 11000) return res.status(409).json({ message: 'Este nombre de usuario ya está en uso' });
        res.status(500).json({ message: 'Error al actualizar perfil' });
    }
};
