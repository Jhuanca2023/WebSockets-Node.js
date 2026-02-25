import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import Message from '../models/Message';
import Room from '../models/Room';
import User from '../models/User';

const JWT_SECRET = process.env.JWT_SECRET || 'secret';

// In-memory store for active room members
// Map<roomId, Map<socketId, userData>>
const roomMembers = new Map<string, Map<string, any>>();

export const socketHandler = (io: Server) => {
    io.use((socket: Socket, next) => {
        const token = socket.handshake.auth.token;
        if (!token) return next(new Error('Authentication error: No token provided'));

        try {
            const decoded = jwt.verify(token, JWT_SECRET) as any;
            (socket as any).user = decoded;
            next();
        } catch (err) {
            next(new Error('Authentication error: Invalid token'));
        }
    });

    io.on('connection', (socket: Socket) => {
        const user = (socket as any).user;
        let currentRoomId = '';

        // Join Room
        socket.on('join-room', async (data: { roomId: string, userName?: string, userAvatar?: string }) => {
            const { roomId } = data;
            let { userName, userAvatar } = data;

            // Basic validation
            if (!roomId) return;

            // Ensure room exists
            const roomExists = await Room.findById(roomId);
            if (!roomExists) {
                return socket.emit('error-msg', 'La sala no existe o ha sido eliminada');
            }

            currentRoomId = roomId;
            socket.join(roomId);

            // If metadata is missing, try to fetch from DB
            if (!userName) {
                const dbUser = await User.findById(user.id);
                if (dbUser) {
                    userName = dbUser.name;
                    userAvatar = dbUser.profileImage;
                }
            }

            if (!roomMembers.has(roomId)) {
                roomMembers.set(roomId, new Map());
            }

            // Sync user to room map
            roomMembers.get(roomId)?.set(socket.id, {
                userId: user.id,
                name: userName || 'Usuario',
                avatar: userAvatar,
                socketId: socket.id
            });

            // Notify room of join (System message)
            io.to(roomId).emit('receive-message', {
                roomId,
                userId: 'system',
                userName: 'Sistema',
                content: `${userName || 'Un usuario'} se ha unido a la conversación`,
                createdAt: new Date()
            });

            // Broadcast updated member list
            const memberList = Array.from(roomMembers.get(roomId)?.values() || []);
            io.to(roomId).emit('room-members', memberList);

            console.log(`🏠 Usuario ${userName} (${user.id}) se unió a ${roomId}`);
        });

        // Send Message
        socket.on('send-message', async (data: { roomId: string, content: string, userAvatar?: string }) => {
            try {
                // Find user info in our room map to include the name
                const roomData = roomMembers.get(data.roomId);
                const senderData = roomData?.get(socket.id);

                const newMessage = new Message({
                    roomId: data.roomId,
                    userId: user.id,
                    content: data.content
                });

                await newMessage.save();

                const messageData = {
                    roomId: data.roomId,
                    userId: user.id,
                    userName: senderData?.name || 'Usuario',
                    userAvatar: data.userAvatar || senderData?.avatar,
                    content: data.content,
                    createdAt: newMessage.createdAt
                };

                io.to(data.roomId).emit('receive-message', messageData);
            } catch (error) {
                console.error('Error al enviar mensaje:', error);
            }
        });

        // Kick Member (Only Host)
        socket.on('kick-member', async (data: { roomId: string, targetSocketId: string }) => {
            try {
                const room = await Room.findById(data.roomId);
                if (!room) return;

                // Verify if requester is host
                if (room.hostId.toString() !== user.id) {
                    return socket.emit('error-msg', 'No tienes permisos para expulsar a nadie');
                }

                // Disconnect target from room
                const targetSocket = io.sockets.sockets.get(data.targetSocketId);
                if (targetSocket) {
                    targetSocket.leave(data.roomId);
                    targetSocket.emit('kicked', { roomId: data.roomId });

                    // Remove from our map
                    roomMembers.get(data.roomId)?.delete(data.targetSocketId);

                    // Re-broadcast list
                    const memberList = Array.from(roomMembers.get(data.roomId)?.values() || []);
                    io.to(data.roomId).emit('room-members', memberList);
                }
            } catch (err) {
                console.error('Error in kick-member:', err);
            }
        });

        socket.on('disconnect', () => {
            if (currentRoomId && roomMembers.has(currentRoomId)) {
                roomMembers.get(currentRoomId)?.delete(socket.id);

                // Re-broadcast updated list
                const memberList = Array.from(roomMembers.get(currentRoomId)?.values() || []);
                io.to(currentRoomId).emit('room-members', memberList);
            }
            console.log(`❌ Usuario desconectado: ${socket.id}`);
        });
    });
};
