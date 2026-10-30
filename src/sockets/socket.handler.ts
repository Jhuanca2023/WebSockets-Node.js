import { Server, Socket } from 'socket.io';
import { canPerform } from '../modules/rooms/room-policy';
import Message from '../models/Message';
import Room from '../models/Room';
import User from '../models/User';
import { authenticate } from '../modules/auth/authenticate';
import { canAccessRoom, canReadMessage, isResourceId } from '../modules/rooms/room-access';

type Identity = Awaited<ReturnType<typeof authenticate>>;
type Ack = (result: { ok: boolean; code?: string; message?: string; messageId?: string }) => void;
class CommandError extends Error {
    constructor(public code: string, message: string) { super(message); }
}

export const socketHandler = (io: Server) => {
    const broadcasts = new Map<string, { roomId: string; name: string; mode: string }>();
    const watchers = new Map<string, Set<string>>();
    const members = new Map<string, { socket: Socket; user: Identity; roomId: string }>();
    io.use(async (socket, next) => {
        try {
            socket.data.user = await authenticate(socket.handshake.auth.token);
            next();
        } catch { next(new Error('Authentication failed')); }
    });

    async function authorizedRoom(roomId: unknown, userId: string) {
        if (!isResourceId(roomId)) throw new CommandError('INVALID_INPUT', 'ID de sala inválido');
        const room = await Room.findById(roomId);
        if (!room) throw new CommandError('NOT_FOUND', 'La sala no existe');
        if (!await canAccessRoom(room, userId)) throw new CommandError('FORBIDDEN', 'No tienes acceso a esta sala');
        return room;
    }

    // Do not trust stale subscriptions after a role, ban or ACL change.
    async function deliver(roomId: string, event: string, payload: unknown,
        message?: { userId: unknown; recipientId?: unknown }) {
        await Promise.all(Array.from(members.values()).filter(member => member.roomId === roomId).map(async member => {
            try {
                const user = await authenticate(member.socket.handshake.auth.token);
                await authorizedRoom(roomId, user.id);
                if (members.get(member.socket.id) !== member || !member.socket.connected) return;
                if (!message || canReadMessage(message, user.id)) member.socket.emit(event, payload);
            } catch {
                if (members.get(member.socket.id) !== member) return;
                members.delete(member.socket.id);
                await member.socket.leave(roomId);
                member.socket.emit('access-denied', { message: 'Tu acceso a la sala ha cambiado' });
            }
        }));
    }

    async function publishMembers(roomId: string) {
        const visible = [];
        for (const member of Array.from(members.values()).filter(m => m.roomId === roomId)) {
            try {
                const user = await authenticate(member.socket.handshake.auth.token);
                await authorizedRoom(roomId, user.id);
                if (user.status !== 'invisible') visible.push({ userId: user.id, name: user.name, avatar: user.avatar, status: user.status, socketId: member.socket.id });
            } catch { /* Revoked sessions are excluded from presence. */ }
        }
        await deliver(roomId, 'room-members', visible);
    }

    io.on('connection', socket => {
        let lastTyping = 0;
        let lastSignal = 0;
        let signalCount = 0;
        const publishStreams = async (roomId: string) => deliver(roomId, 'media-streams', Array.from(broadcasts.entries()).filter(([, value]) => value.roomId === roomId).map(([socketId, value]) => ({ socketId, ...value, viewerCount: watchers.get(socketId)?.size ?? 0 })));
        const stopBroadcast = async () => {
            const broadcast = broadcasts.get(socket.id);
            broadcasts.delete(socket.id);
            watchers.delete(socket.id);
            const affectedRooms = new Set<string>();
            for (const [publisher, viewers] of watchers) if (viewers.delete(socket.id)) {
                io.to(publisher).emit('media-viewer-left', { socketId: socket.id });
                const active = broadcasts.get(publisher); if (active) affectedRooms.add(active.roomId);
            }
            if (broadcast) await publishStreams(broadcast.roomId);
            for (const roomId of affectedRooms) await publishStreams(roomId);
        };
        let queue: Promise<unknown> = Promise.resolve();
        const command = (event: string, handler: (data: any, user: Identity) => Promise<{ messageId?: string } | void>) => {
            socket.on(event, (data: unknown, ack?: Ack) => {
                // Serialize navigation and commands from the same connection.
                queue = queue.then(async () => {
                    if (!socket.connected) return;
                    try {
                        const user = await authenticate(socket.handshake.auth.token);
                        const result = await handler(data, user);
                        if (typeof ack === 'function') ack({ ok: true, ...result });
                    } catch (error) {
                        const known = error instanceof CommandError;
                        const code = known ? error.code : 'COMMAND_FAILED';
                        const message = known ? error.message : 'No se pudo completar la operación';
                        if (typeof ack === 'function') ack({ ok: false, code, message });
                        else socket.emit('error-msg', message);
                    }
                }).catch(() => { /* Keep the queue available after transport errors. */ });
            });
        };

        command('join-room', async (data, user) => {
            const room = await authorizedRoom(data?.roomId, user.id);
            const roomId = String(room._id);
            const previous = members.get(socket.id);
            if (previous?.roomId === roomId) return;
            if (previous) {
                members.delete(socket.id);
                await socket.leave(previous.roomId);
                await publishMembers(previous.roomId);
            }
            if (!socket.connected) return;
            await socket.join(roomId);
            members.set(socket.id, { socket, user, roomId });
            await publishMembers(roomId);
            await publishStreams(roomId);
        });

        command('send-message', async (data, user) => {
            const room = await authorizedRoom(data?.roomId, user.id);
            const roomId = String(room._id);
            if (!await canPerform(room, user.id, 'sendMessages') || !await canPerform(room, user.id, data.type === 'AUDIO' ? 'sendAudio' : data.type === 'FILE' ? 'sendFiles' : 'sendMessages')) throw new CommandError('FORBIDDEN', 'El canal está cerrado o no tienes permiso para enviar este contenido');
            if (members.get(socket.id)?.roomId !== roomId) {
                throw new CommandError('NOT_JOINED', 'Entra a la sala antes de enviar mensajes');
            }
            if (typeof data.content !== 'string' || !data.content.trim() || data.content.length > 4000 ||
                (data.type !== undefined && !['TEXT', 'FILE', 'AUDIO', 'SCREEN_SHARE'].includes(data.type)) ||
                (data.fileUrl != null && (typeof data.fileUrl !== 'string' || data.fileUrl.length > 2048)) ||
                (data.clientMessageId !== undefined && (typeof data.clientMessageId !== 'string' ||
                    !/^[a-zA-Z0-9-]{16,80}$/.test(data.clientMessageId)))) {
                throw new CommandError('INVALID_INPUT', 'Mensaje inválido');
            }
            const recipientId = data.recipientId ?? null;
            if (recipientId !== null) {
                if (!isResourceId(recipientId)) throw new CommandError('INVALID_INPUT', 'Destinatario inválido');
                const recipient = await User.findById(recipientId).select('isBanned').lean();
                if (!recipient || recipient.isBanned || !await canAccessRoom(room, recipientId)) {
                    throw new CommandError('FORBIDDEN', 'El destinatario no tiene acceso a esta sala');
                }
            }
            const draft = {
                roomId, userId: user.id, userName: user.name, userAvatar: user.avatar,
                content: data.content.trim(), type: data.type ?? 'TEXT', fileUrl: data.fileUrl ?? null,
                recipientId, ...(data.clientMessageId ? { clientMessageId: data.clientMessageId } : {})
            };
            let message;
            try {
                message = await Message.create(draft);
            } catch (error: any) {
                if (error?.code !== 11000 || !data.clientMessageId) throw error;
                message = await Message.findOne({ userId: user.id, clientMessageId: data.clientMessageId });
                if (!message || String(message.roomId) !== roomId || message.content !== draft.content ||
                    String(message.recipientId ?? '') !== String(recipientId ?? '') ||
                    message.type !== draft.type || (message.fileUrl ?? null) !== draft.fileUrl) {
                    throw new CommandError('CONFLICT', 'El identificador ya pertenece a otro mensaje');
                }
            }
            await deliver(roomId, 'receive-message', message.toObject(), message);
            return { messageId: String(message._id) };
        });

        command('send-reaction', async (data, user) => {
            const room = await authorizedRoom(data?.roomId, user.id);
            const roomId = String(room._id);
            if (!isResourceId(data?.messageId) || typeof data.emoji !== 'string' ||
                !data.emoji.trim() || data.emoji.length > 32) {
                throw new CommandError('INVALID_INPUT', 'Reacción inválida');
            }
            const message = await Message.findOne({ _id: data.messageId, roomId });
            if (!message || !canReadMessage(message, user.id)) {
                throw new CommandError('FORBIDDEN', 'No puedes reaccionar a este mensaje');
            }
            const updated = await Message.updateOne({ _id: message._id, reactions: {
                $not: { $elemMatch: { userId: user.id, emoji: data.emoji } }
            } }, { $push: { reactions: { userId: user.id, emoji: data.emoji } } });
            if (updated.modifiedCount) {
                await deliver(roomId, 'message-reaction', {
                    messageId: String(message._id), roomId, userId: user.id, emoji: data.emoji
                }, message);
            }
        });

        command('forward-message', async (data, user) => {
            const source = await authorizedRoom(data?.sourceRoomId, user.id);
            const destination = await authorizedRoom(data?.destinationRoomId, user.id);
            if (!await canPerform(destination, user.id, 'sendMessages')) {
                throw new CommandError('FORBIDDEN', 'No tienes permiso para escribir en el destino');
            }
            if (!isResourceId(data?.messageId) || (data.note !== undefined &&
                (typeof data.note !== 'string' || data.note.length > 500))) {
                throw new CommandError('INVALID_INPUT', 'Datos de reenvío inválidos');
            }
            const original = await Message.findOne({ _id: data.messageId, roomId: source._id });
            if (!original || !canReadMessage(original, user.id)) {
                throw new CommandError('FORBIDDEN', 'No puedes reenviar este mensaje');
            }
            const reference = `↪ ${original.userName}: ${original.content}`;
            const content = [data.note?.trim(), reference].filter(Boolean).join('\n\n').slice(0, 4000);
            const forwarded: any = await Message.create({
                roomId: destination._id, userId: user.id, userName: user.name, userAvatar: user.avatar,
                content, type: original.type, ...(original.fileUrl ? { fileUrl: original.fileUrl } : {})
            });
            await deliver(String(destination._id), 'receive-message', forwarded.toObject(), forwarded);
            return { messageId: String(forwarded._id) };
        });

        command('typing', async (data, user) => {
            const room = await authorizedRoom(data?.roomId, user.id);
            if (members.get(socket.id)?.roomId !== String(room._id) || !await canPerform(room, user.id, 'sendMessages')) return;
            if (Date.now() - lastTyping < 800 && data.active) return;
            lastTyping = Date.now();
            await deliver(String(room._id), 'typing', { roomId: String(room._id), userId: user.id, name: user.name, active: !!data.active });
        });
        command('media-start', async (data, user) => {
            const room = await authorizedRoom(data?.roomId, user.id);
            if (members.get(socket.id)?.roomId !== String(room._id) || !await canPerform(room, user.id, data.mode === 'voice' ? 'sendAudio' : 'shareScreen')) throw new CommandError('FORBIDDEN', 'No puedes transmitir en este canal');
            if (!['screen', 'voice'].includes(data.mode)) throw new CommandError('INVALID_INPUT', 'Tipo de transmisión inválido');
            broadcasts.set(socket.id, { roomId: String(room._id), name: user.name, mode: data.mode });
            await publishStreams(String(room._id));
        });
        command('media-stop', async () => { await stopBroadcast(); });
        command('media-list', async (data, user) => {
            const room = await authorizedRoom(data?.roomId, user.id);
            await publishStreams(String(room._id));
        });
        command('media-watch', async (data, user) => {
            const broadcast = broadcasts.get(data?.publisher);
            if (!broadcast || broadcast.roomId !== members.get(socket.id)?.roomId || data.publisher === socket.id) throw new CommandError('FORBIDDEN', 'Transmisión no disponible');
            const room = await authorizedRoom(broadcast.roomId, user.id);
            const publisher = members.get(data.publisher);
            if (!publisher || !await canPerform(room, publisher.user.id, broadcast.mode === 'voice' ? 'sendAudio' : 'shareScreen')) throw new CommandError('FORBIDDEN', 'Transmisión no disponible');
            const viewers = watchers.get(data.publisher) || new Set<string>();
            if (viewers.size >= 6 && !viewers.has(socket.id)) throw new CommandError('LIMIT', 'Esta transmisión admite hasta 6 espectadores');
            viewers.add(socket.id); watchers.set(data.publisher, viewers);
            io.to(data.publisher).emit('media-viewer', { socketId: socket.id, userId: user.id, name: user.name, avatar: user.avatar });
            await publishStreams(broadcast.roomId);
        });
        command('media-unwatch', async (data, user) => {
            const broadcast = broadcasts.get(data?.publisher);
            const viewers = watchers.get(data?.publisher);
            if (!broadcast || !viewers || !viewers.has(socket.id)) return;
            await authorizedRoom(broadcast.roomId, user.id);
            viewers.delete(socket.id);
            io.to(data.publisher).emit('media-viewer-left', { socketId: socket.id });
            await publishStreams(broadcast.roomId);
        });
        command('media-signal', async (data, user) => {
            if (Date.now() - lastSignal > 1000) { lastSignal = Date.now(); signalCount = 0; }
            if (++signalCount > 80) throw new CommandError('LIMIT', 'Demasiadas señales');
            const target = members.get(data?.target);
            const self = members.get(socket.id);
            if (!target || !self || target.roomId !== self.roomId || !(watchers.get(socket.id)?.has(data.target) || watchers.get(data.target)?.has(socket.id))) throw new CommandError('FORBIDDEN', 'Señal no autorizada');
            const room = await authorizedRoom(self.roomId, user.id);
            await authorizedRoom(self.roomId, target.user.id);
            const publisherId = broadcasts.has(socket.id) ? socket.id : data.target;
            const publisher = members.get(publisherId);
            const broadcast = broadcasts.get(publisherId);
            if (!publisher || !broadcast || !await canPerform(room, publisher.user.id, broadcast.mode === 'voice' ? 'sendAudio' : 'shareScreen')) throw new CommandError('FORBIDDEN', 'Transmisión cerrada');
            if (!data.signal || JSON.stringify(data.signal).length > 20000) throw new CommandError('INVALID_INPUT', 'Señal inválida');
            io.to(data.target).emit('media-signal', { from: socket.id, signal: data.signal });
        });
        socket.on('disconnect', () => {
            void stopBroadcast();
            const previous = members.get(socket.id);
            members.delete(socket.id);
            if (previous) void publishMembers(previous.roomId).catch(() => {});
        });
    });
};
