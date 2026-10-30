import { Router } from 'express';
import Room from '../../models/Room';
import User from '../../models/User';
import Membership from '../../models/Membership';
import { authMiddleware } from '../../middlewares/auth';
import { canAccessRoom, isResourceId, roomOwnerId } from './room-access';

const router = Router();
router.use(authMiddleware);
const publicFields = '_id name username bio status statusText bannerColor profileImage createdAt';
router.get('/:id/members', async (req: any, res) => {
    if (!isResourceId(req.params.id)) return res.sendStatus(400);
    const room = await Room.findById(req.params.id);
    if (!room || !await canAccessRoom(room, req.user.id)) return res.sendStatus(403);
    const root = room.parentRoomId ? await Room.findById(room.parentRoomId) : room;
    if (!root) return res.sendStatus(404);
    const memberships = await Membership.find({ roomId: root._id }).select('userId');
    const users = await User.find({ _id: { $in: [root.hostId, ...(root.authorizedUsers || []), ...memberships.map(m => m.userId)] }, isBanned: false }).select(publicFields).lean();
    const allowed = await Promise.all(users.map(user => canAccessRoom(room, String(user._id))));
    res.json(users.filter((_, index) => allowed[index]).map(user => ({ ...user, status: user.status === 'invisible' ? 'offline' : user.status, muted: room.mutedUsers?.some(id => String(id) === String(user._id)) || false })));
});
router.put('/:id/members/:userId/mute', async (req: any, res) => {
    if (!isResourceId(req.params.id) || !isResourceId(req.params.userId) || typeof req.body.muted !== 'boolean') return res.sendStatus(400);
    const room = await Room.findById(req.params.id);
    if (!room || room.kind === 'direct' || roomOwnerId(room) !== req.user.id || req.params.userId === req.user.id) return res.sendStatus(403);
    if (!await canAccessRoom(room, req.params.userId)) return res.sendStatus(404);
    await Room.updateOne({ _id: room._id }, req.body.muted ? { $addToSet: { mutedUsers: req.params.userId } } : { $pull: { mutedUsers: req.params.userId } });
    req.app.get('io')?.to(String(room._id)).emit('room-updated', { roomId: String(room._id) });
    res.json({ muted: req.body.muted });
});
router.post('/:id/direct', async (req: any, res) => {
    const recipientId = req.body.recipientId;
    if (!isResourceId(req.params.id) || !isResourceId(recipientId) || recipientId === req.user.id) return res.sendStatus(400);
    const room = await Room.findById(req.params.id);
    const recipient = await User.findById(recipientId).select('name isBanned');
    if (!room || !recipient || recipient.isBanned || !await canAccessRoom(room, req.user.id) || !await canAccessRoom(room, recipientId)) return res.sendStatus(403);
    const ids = [req.user.id, recipientId].sort();
    const directKey = ids.join(':');
    let conversation;
    try {
        conversation = await Room.findOneAndUpdate({ directKey }, { $setOnInsert: { kind: 'direct', directKey, name: 'Conversación directa', hostId: ids[0], authorizedUsers: ids, isPrivate: true } }, { upsert: true, new: true });
    } catch (error: any) {
        if (error.code !== 11000) throw error;
        conversation = await Room.findOne({ directKey });
    }
    res.json(conversation);
});
export default router;
