import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import Message from '../models/Message';
import Room from '../models/Room';
import User from '../models/User';

const JWT_SECRET = process.env.JWT_SECRET || 'secret';

// Store room members in memory for easy access
const roomMembers = new Map<string, Map<string, any>>();

export const socketHandler = (io: Server) => {
    console.log('Socket Handler: Expert Mode Enabled');

    const sanitizeAvatar = (value?: string) => {
        if (!value) return '';
        if (value.startsWith('data:')) return '';
        if (value.length > 2048) return '';
        return value;
    };

    // Authentication Middleware
    io.use(async (socket: Socket, next) => {
        try {
            const token = socket.handshake.auth.token;
            if (!token) return next(new Error('Auth failed: No token'));

            const decoded = jwt.verify(token, JWT_SECRET) as any;
            if (!decoded || !decoded.id) return next(new Error('Auth failed: Invalid token'));

            // Pre-fetch user name and avatar to avoid issues later
            const fullUser = await User.findById(decoded.id).select('name email profileImage role').lean();
            if (!fullUser) return next(new Error('Auth failed: User not found'));

            (socket as any).user = {
                id: String(fullUser._id),
                name: fullUser.name,
                role: fullUser.role || 'USER',
                email: fullUser.email,
                avatar: sanitizeAvatar(fullUser.profileImage || '')
            };

            console.log(`Authorized: ${(socket as any).user.name}`);
            next();
        } catch (err: any) {
            console.error('Socket Auth:', err.message);
            next(new Error('Authentication failed'));
        }
    });

    io.on('connection', (socket: Socket) => {
        const user = (socket as any).user;
        console.log(`Connected: ${socket.id} (User: ${user.name})`);
        console.log('Transport:', socket.conn.transport.name, '| Origin:', socket.handshake.headers.origin);

        socket.conn.on('close', (reason: string, description: any) => {
            console.log('Transport closed:', {
                socketId: socket.id,
                reason,
                description
            });
        });

        let currentRoomId = '';

        // Join Room
        socket.on('join-room', async (data: any) => {
            try {
                console.log('join-room received:', data);
                if (!data || !data.roomId) {
                    console.log('Invalid data');
                    return;
                }
                const roomId = String(data.roomId);
                console.log('Looking for room:', roomId);

                const room = await Room.findById(roomId);
                if (!room) {
                    console.log('Room not found');
                    return socket.emit('error-msg', 'La sala no existe');
                }
                console.log('Room found:', room.name, 'Parent:', room.parentRoomId);

                // Security Check (ACL) only for sub-rooms:
                // allow: host de la sub-sala, host de la sala padre, o usuarios autorizados
                if (room.parentRoomId) {
                    const authorizedUsers = room.authorizedUsers?.map((id: any) => String(id)) || [];
                    const isSubRoomHost = String(room.hostId) === String(user.id);
                    let isParentHost = false;

                    if (room.parentRoomId) {
                        const parent = await Room.findById(room.parentRoomId).select('hostId').lean();
                        if (parent) {
                            isParentHost = String(parent.hostId) === String(user.id);
                        }
                    }

                    const isAuthorized = authorizedUsers.includes(user.id);
                    if (!isSubRoomHost && !isParentHost && !isAuthorized) {
                        console.log('Not authorized to join sub-room');
                        socket.emit('access-denied', { message: 'Necesitas permisos para entrar a esta sub-sala' });
                        return;
                    }
                }

                console.log('Joining room:', roomId);
                socket.join(roomId);
                currentRoomId = roomId;

                if (!roomMembers.has(roomId)) roomMembers.set(roomId, new Map());

                const userData = {
                    userId: user.id,
                    name: user.name,
                    avatar: user.avatar,
                    email: user.email,
                    socketId: socket.id
                };
                roomMembers.get(roomId)?.set(socket.id, userData);

                // Broadcast member list
                const members = Array.from(roomMembers.get(roomId)?.values() || []);
                io.to(roomId).emit('room-members', members);

                // System notification
                io.to(roomId).emit('receive-message', {
                    roomId,
                    userId: 'system',
                    userName: 'Sistema',
                    content: `${userData.name} se unió`,
                    createdAt: new Date()
                });
                console.log('Joined room successfully');
            } catch (err) {
                console.error('Error join-room:', err);
                socket.disconnect();
            }
        });

        // Send Message
        socket.on('send-message', async (data: any) => {
            try {
                if (!data || !data.roomId || !data.content) return;
                const roomId = String(data.roomId);

                const newMessage = new Message({
                    roomId,
                    userId: user.id,
                    userName: user.name,
                    userAvatar: user.avatar,
                    content: data.content,
                    type: data.type || 'TEXT',
                    fileUrl: data.fileUrl || null,
                    recipientId: data.recipientId || null
                });

                await newMessage.save();

                const emitData = {
                    ...newMessage.toObject(),
                    _id: newMessage._id,
                    createdAt: newMessage.createdAt
                };

                if (data.recipientId) {
                    socket.emit('receive-message', emitData);
                    const roomData = roomMembers.get(roomId);
                    const target = Array.from(roomData?.values() || []).find(m => String(m.userId) === String(data.recipientId));
                    if (target) io.to(target.socketId).emit('receive-message', emitData);
                } else {
                    io.to(roomId).emit('receive-message', emitData);
                }
            } catch (err) {
                console.error('Error send-message:', err);
            }
        });

        // Send Reaction
        socket.on('send-reaction', async (data: any) => {
            try {
                if (!data || !data.messageId) return;
                const updated = await Message.findByIdAndUpdate(
                    data.messageId,
                    { $push: { reactions: { userId: user.id, emoji: data.emoji } } },
                    { new: true }
                );

                if (updated) {
                    io.to(data.roomId).emit('message-reaction', {
                        messageId: data.messageId,
                        roomId: data.roomId,
                        userId: user.id,
                        emoji: data.emoji
                    });
                }
            } catch (err) {
                console.error('Error reaction:', err);
            }
        });

        socket.on('disconnect', (reason) => {
            if (currentRoomId && roomMembers.has(currentRoomId)) {
                roomMembers.get(currentRoomId)?.delete(socket.id);
                const members = Array.from(roomMembers.get(currentRoomId)?.values() || []);
                io.to(currentRoomId).emit('room-members', members);
            }
            console.log(`Disconnected ${socket.id}: ${reason}`);
        });
    });
};
