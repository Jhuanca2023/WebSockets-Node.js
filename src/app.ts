import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import authRoutes from './modules/auth/auth.routes';
import roomRoutes from './modules/rooms/rooms.routes';

dotenv.config();

const app = express();

// Middlewares
app.use(cors({
    origin: process.env.CLIENT_URL || 'http://localhost:4200',
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/rooms', roomRoutes);

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'OK', message: 'Chat API is running' });
});

export default app;
