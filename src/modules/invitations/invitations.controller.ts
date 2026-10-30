import { randomBytes, createHash } from 'crypto';
import { Response } from 'express';
import { AuthRequest } from '../../middlewares/auth';
import Room from '../../models/Room';
import User from '../../models/User';
import Membership from '../../models/Membership';
import Invitation from '../../models/Invitation';
import { isResourceId, roomOwnerId, canAccessRoom } from '../rooms/room-access';

const fail = (res: Response, status: number, message: string) => res.status(status).json({ message });
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const validToken = (token: unknown): token is string => typeof token === 'string' && /^[a-f\d]{64}$/i.test(token);
const expiry = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

async function ownedRoom(req: AuthRequest) {
    if (!isResourceId(req.params.id)) return null;
    const room = await Room.findById(req.params.id);
    return room && room.kind !== 'direct' && !room.archived && roomOwnerId(room) === req.user.id ? room : null;
}
async function addMember(roomId: unknown, userId: string) {
    const room = await Room.findById(String(roomId));
    if (!room || room.archived) throw new Error('Servidor cerrado');
    if (room.parentRoomId && !await canAccessRoom(await Room.findById(room.parentRoomId) as any, userId)) throw new Error('Primero acepta la invitación al servidor');
    const target = String(roomId);
    try {
        await Membership.updateOne({ roomId: target, userId }, { $setOnInsert: { roomId: target, userId } }, { upsert: true });
    } catch (error: any) {
        if (error?.code !== 11000 || !await Membership.exists({ roomId: target, userId })) throw error;
    }
}

export const createLink = async (req: AuthRequest, res: Response) => {
    try {
        const room = await ownedRoom(req);
        if (!room) return fail(res, 403, 'Solo el propietario puede invitar a este servidor');
        const token = randomBytes(32).toString('hex');
        const invite = await Invitation.create({ roomId: room._id, inviterId: req.user.id,
            kind: 'link', tokenHash: hashToken(token), expiresAt: expiry() });
        return res.status(201).json({ id: invite._id, token, expiresAt: invite.expiresAt });
    } catch { return fail(res, 500, 'No se pudo crear el enlace'); }
};

export const revokeLink = async (req: AuthRequest, res: Response) => {
    try {
        const room = await ownedRoom(req);
        if (!room || !isResourceId(req.params.inviteId)) return fail(res, 403, 'No puedes revocar esta invitación');
        const result = await Invitation.updateOne({ _id: req.params.inviteId, roomId: room._id,
            kind: 'link', status: 'pending' }, { $set: { status: 'revoked' } });
        if (!result.matchedCount) return fail(res, 404, 'El enlace ya no está disponible');
        return res.json({ message: 'Enlace revocado' });
    } catch { return fail(res, 500, 'No se pudo revocar el enlace'); }
};

async function linkDetails(token: unknown) {
    if (!validToken(token)) return null;
    const invite = await Invitation.findOne({ tokenHash: hashToken(token.toLowerCase()), kind: 'link',
        status: 'pending', expiresAt: { $gt: new Date() } });
    if (!invite) return null;
    const room = await Room.findById(invite.roomId);
    if (!room || room.archived) return null;
    return { invite, room };
}

export const previewLink = async (req: AuthRequest, res: Response) => {
    try {
        const details = await linkDetails(req.params.token);
        if (!details) return fail(res, 404, 'La invitación ha vencido, fue revocada o no existe');
        const { room, invite } = details;
        return res.json({ room: { _id: room._id, name: room.name, description: room.description,
            imageUrl: room.imageUrl }, expiresAt: invite.expiresAt,
            alreadyMember: await canAccessRoom(room, req.user.id) });
    } catch { return fail(res, 500, 'No se pudo consultar la invitación'); }
};

export const joinLink = async (req: AuthRequest, res: Response) => {
    try {
        const details = await linkDetails(req.body?.token);
        if (!details) return fail(res, 404, 'La invitación ha vencido, fue revocada o no existe');
        await addMember(details.room._id, req.user.id);
        return res.json({ roomId: details.room._id });
    } catch { return fail(res, 500, 'No se pudo entrar al servidor'); }
};

export const sendInvitation = async (req: AuthRequest, res: Response) => {
    try {
        const room = await ownedRoom(req);
        if (!room) return fail(res, 403, 'Solo el propietario puede invitar a este servidor');
        const username = req.body?.username;
        const email = req.body?.recipientEmail;
        if (username !== undefined && (typeof username !== 'string' || !/^[a-z0-9_]{3,24}$/i.test(username))) return fail(res, 400, 'Usuario inválido');
        if (username === undefined && (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))) {
            return fail(res, 400, 'Introduce un correo válido');
        }
        const escaped = (email || '').trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const recipient = await User.findOne({ ...(username ? { username: username.toLowerCase() } : { email: new RegExp('^' + escaped + '$', 'i') }), isBanned: false });
        if (!recipient) return fail(res, 404, 'No encontramos una cuenta disponible con ese correo');
        if (room.parentRoomId) {
            const parent = await Room.findById(room.parentRoomId);
            if (!parent || !await canAccessRoom(parent, String(recipient._id))) return fail(res, 409, 'Primero invita a esta persona al servidor');
        }
        if (await canAccessRoom(room, String(recipient._id))) return fail(res, 409, 'Esta persona ya pertenece al servidor');
        const invite = await Invitation.findOneAndUpdate({ roomId: room._id, recipientId: recipient._id,
            kind: 'direct', status: 'pending' }, { $set: { inviterId: req.user.id, expiresAt: expiry() } },
            { new: true, upsert: true, setDefaultsOnInsert: true });
        return res.status(201).json({ id: invite._id, message: 'Invitación enviada a su bandeja' });
    } catch { return fail(res, 500, 'No se pudo enviar la invitación'); }
};

export const inbox = async (req: AuthRequest, res: Response) => {
    try {
        const invitations = await Invitation.find({ recipientId: req.user.id, kind: 'direct',
            status: 'pending', expiresAt: { $gt: new Date() } })
            .populate('roomId', 'name description imageUrl').populate('inviterId', 'name')
            .sort({ createdAt: -1 }).limit(100);
        return res.json(invitations.filter(invite => invite.roomId && invite.inviterId).map(invite => ({
            id: invite._id, room: invite.roomId, inviter: invite.inviterId,
            createdAt: invite.createdAt, expiresAt: invite.expiresAt
        })));
    } catch { return fail(res, 500, 'No se pudo cargar la bandeja'); }
};

export const acceptInvitation = async (req: AuthRequest, res: Response) => {
    try {
        if (!isResourceId(req.params.id)) return fail(res, 400, 'Invitación inválida');
        const invite = await Invitation.findOne({ _id: req.params.id, recipientId: req.user.id,
            kind: 'direct', status: { $in: ['pending', 'accepted'] }, expiresAt: { $gt: new Date() } });
        if (!invite) return fail(res, 404, 'La invitación ya no está disponible para tu cuenta');
        const room = await Room.findById(invite.roomId);
        if (!room || room.archived) return fail(res, 404, 'Este servidor ya no está disponible');
        if (invite.status === 'accepted' && !await canAccessRoom(room, req.user.id)) {
            return fail(res, 409, 'Esta invitación ya fue utilizada');
        }
        await addMember(room._id, req.user.id);
        await Invitation.updateOne({ _id: invite._id, recipientId: req.user.id }, { $set: { status: 'accepted' } });
        return res.json({ roomId: room._id });
    } catch { return fail(res, 500, 'No se pudo aceptar la invitación'); }
};

export const declineInvitation = async (req: AuthRequest, res: Response) => {
    try {
        if (!isResourceId(req.params.id)) return fail(res, 400, 'Invitación inválida');
        const result = await Invitation.updateOne({ _id: req.params.id, recipientId: req.user.id,
            kind: 'direct', status: 'pending' }, { $set: { status: 'declined' } });
        if (!result.matchedCount) return fail(res, 404, 'La invitación ya no está disponible para tu cuenta');
        return res.json({ message: 'Invitación rechazada' });
    } catch { return fail(res, 500, 'No se pudo rechazar la invitación'); }
};
