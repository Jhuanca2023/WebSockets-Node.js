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
        console.log(`🔒 Intento conexión: ${socket.id} | Token: ${token ? 'Sí' : 'No'}`);
        if (!token) return next(new Error('Authentication error: No token provided'));

        try {
            const decoded = jwt.verify(token, JWT_SECRET) as any;
            (socket as any).user = decoded;
            console.log(`✅ Auth OK: ${decoded.id}`);
            next();
        } catch (err: any) {
            console.error('❌ Auth Fail:', err.message);
            next(new Error('Authentication error: Invalid token'));
        }
    });

    io.on('connection', (socket: Socket) => {
        const user = (socket as any).user;
        console.log(`🔌 Conectado: ${socket.id} | User: ${user?.id}`);

        // Logger para todos los eventos
        socket.onAny((eventName, ...args) => {
            console.log(`📡 [${socket.id}] Recibido: ${eventName}`, args);
        });

        let currentRoomId = '';

        // Join Room
        socket.on('join-room', async (data: any) => {
            console.log('📡 Evento join-room recibido para sala:', data?.roomId);
            if (!data || !data.roomId) return;

            try {
                const roomId = String(data.roomId);
                const { userName, userAvatar } = data;
                socket.join(roomId);
                currentRoomId = roomId;

                if (!roomMembers.has(roomId)) {
                    roomMembers.set(roomId, new Map());
                }

                roomMembers.get(roomId)?.set(socket.id, {
                    userId: user.id,
                    name: userName || 'Usuario',
                    avatar: userAvatar,
                    socketId: socket.id
                });

                // Notificar a todos
                const members = Array.from(roomMembers.get(roomId)?.values() || []);
                console.log(`👥 Emitiendo lista de miembros (${members.length}) a sala ${roomId}`);
                io.to(roomId).emit('room-members', members);

                io.to(roomId).emit('receive-message', {
                    roomId,
                    userId: 'system',
                    userName: 'Sistema',
                    content: `${userName || 'Alguien'} se unió`,
                    createdAt: new Date()
                });

                console.log(`✅ ${userName} (${user.id}) unido a ${roomId}`);
            } catch (err) {
                console.error('❌ Error en join-room:', err);
            }
        });

        // Send Message
        socket.on('send-message', async (data: { roomId: string, content: string, userAvatar?: string }) => {
            const roomId = String(data.roomId);
            console.log(`✉️ Mensaje recibido de ${user.id} para sala ${roomId}: ${data.content}`);
            try {
                // Find user info in our room map to include the name
                const roomData = roomMembers.get(roomId);
                const senderData = roomData?.get(socket.id);

                const newMessage = new Message({
                    roomId: roomId,
                    userId: user.id,
                    content: data.content
                });

                await newMessage.save();
                console.log('💾 Mensaje guardado en DB');

                const messageData = {
                    roomId: roomId,
                    userId: user.id,
                    userName: senderData?.name || 'Usuario',
                    userAvatar: data.userAvatar || senderData?.avatar,
                    content: data.content,
                    createdAt: newMessage.createdAt
                };

                console.log(`📡 Emitiendo mensaje a sala ${roomId}`);
                io.to(roomId).emit('receive-message', messageData);
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

        socket.on('disconnect', (reason) => {
            if (currentRoomId && roomMembers.has(currentRoomId)) {
                roomMembers.get(currentRoomId)?.delete(socket.id);
                const memberList = Array.from(roomMembers.get(currentRoomId)?.values() || []);
                io.to(currentRoomId).emit('room-members', memberList);
            }
            console.log(`❌ Desconectado: ${socket.id} | Razón: ${reason}`);
        });
    });
};
