import dotenv from 'dotenv';
dotenv.config();

import http from 'http';
import { Server } from 'socket.io';
import app from './app';
import { connectDB } from './config/database';
import { socketHandler } from './sockets/socket.handler';
const PORT = 3000;

const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: ['http://localhost:4200', 'http://127.0.0.1:4200'],
        methods: ['GET', 'POST'],
        credentials: true
    },
    transports: ['polling', 'websocket'],
    maxHttpBufferSize: 10e6,
    pingTimeout: 300000, // Increased to 5 minutes
    pingInterval: 60000 // Increased to 1 minute
});

socketHandler(io);

io.engine.on('connection_error', (err) => {
    console.error('Engine connection error:', {
        code: err.code,
        message: err.message,
        context: err.context
    });
});

const startServer = async () => {
    await connectDB();
    server.listen(PORT, () => {
        console.log(`Servidor corriendo en http://localhost:${PORT}`);
    });
};

startServer();

// Catch unhandled errors so the server doesn't silently crash
process.on('unhandledRejection', (reason, promise) => {
    console.error('UnhandledRejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('UncaughtException:', err);
});
