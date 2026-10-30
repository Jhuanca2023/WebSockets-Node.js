import dotenv from 'dotenv';
dotenv.config();

import http from 'http';
import { Server } from 'socket.io';
import app from './app';
import { connectDB } from './config/database';
import { socketHandler } from './sockets/socket.handler';
import Room from './models/Room';
import User from './models/User';
import Message from './models/Message';
import mongoose from 'mongoose';
import Membership from './models/Membership';
import Invitation from './models/Invitation';
const PORT = Number(process.env.PORT || 3000);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error('PORT inválido');

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

app.set('io', io);
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
    await Message.init();
    await Promise.all([Membership.init(), Invitation.init(), Room.init(), User.init()]);
    const indexes = await Message.collection.indexes();
    const retryIndex = indexes.some(index => index.unique &&
        index.key?.userId === 1 && index.key?.clientMessageId === 1);
    if (!retryIndex) throw new Error('Falta el índice único de reintentos de Message; crea los índices antes de iniciar');
    server.listen(PORT, () => {
        console.log(`Servidor corriendo en http://localhost:${PORT}`);
    });
};

startServer().catch(async error => {
    console.error('No se pudo iniciar el servidor:', error.message);
    process.exitCode = 1;
    io.close();
    await mongoose.disconnect();
});

// Catch unhandled errors so the server doesn't silently crash
process.on('unhandledRejection', (reason, promise) => {
    console.error('UnhandledRejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('UncaughtException:', err);
});
