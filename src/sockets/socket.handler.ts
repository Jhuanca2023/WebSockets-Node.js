import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import Message from '../models/Message';

const JWT_SECRET = process.env.JWT_SECRET || 'secret';

export const socketHandler = (io: Server) => {
    // Middleware for socket authentication
    io.use((socket: Socket, next) => {
        const token = socket.handshake.auth.token;
        if (!token) return next(new Error('Authentication error: No token provided'));

        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            (socket as any).user = decoded;
            next();
        } catch (err) {
            next(new Error('Authentication error: Invalid token'));
        }
    });

    io.on('connection', (socket: Socket) => {
        const user = (socket as any).user;
        console.log(`👤 Usuario conectado: ${user.id} (${socket.id})`);

        // Join Room
        socket.on('join-room', (roomId: string) => {
            socket.join(roomId);
            console.log(`🏠 Usuario ${user.id} se unió a la sala: ${roomId}`);

            // Notify others in the room
            socket.to(roomId).emit('user-joined', { userId: user.id });
        });

        // Send Message
        socket.on('send-message', async (data: { roomId: string, content: string }) => {
            try {
                const newMessage = new Message({
                    roomId: data.roomId,
                    userId: user.id,
                    content: data.content
                });

                await newMessage.save();

                const messageData = {
                    roomId: data.roomId,
                    userId: user.id,
                    content: data.content,
                    createdAt: newMessage.createdAt
                };

                // Broadcast message to everyone in the room (including sender)
                io.to(data.roomId).emit('receive-message', messageData);
            } catch (error) {
                console.error('Error al guardar mensaje:', error);
            }
        });

        // Typing activity
        socket.on('typing', (roomId: string) => {
            socket.to(roomId).emit('user-typing', { userId: user.id });
        });

        socket.on('stop-typing', (roomId: string) => {
            socket.to(roomId).emit('user-stop-typing', { userId: user.id });
        });

        socket.on('disconnect', () => {
            console.log(`❌ Usuario desconectado: ${socket.id}`);
        });
    });
};
