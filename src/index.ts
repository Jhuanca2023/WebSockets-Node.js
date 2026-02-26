import dotenv from 'dotenv';
dotenv.config();

import http from 'http';
import { Server } from 'socket.io';
import app from './app';
import { connectDB } from './config/database';
import { socketHandler } from './sockets/socket.handler';

const PORT = process.env.PORT || 3000;

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: process.env.CLIENT_URL || 'http://localhost:4200',
        methods: ['GET', 'POST'],
        credentials: true
    },
    transports: ['websocket', 'polling']
});

// Initialize socket handler
socketHandler(io);

const startServer = async () => {
    await connectDB();
    server.listen(PORT, () => {
        console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    });
};

startServer();

// Catch unhandled errors so the server doesn't silently crash
process.on('unhandledRejection', (reason, promise) => {
    console.error('🔴 UnhandledRejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('🔴 UncaughtException:', err);
});
