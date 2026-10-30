import jwt from 'jsonwebtoken';
import User from '../../models/User';
import { JWT_SECRET } from '../../config/security';
import { isResourceId } from '../rooms/room-access';

export async function authenticate(token: unknown) {
    if (typeof token !== 'string') throw new Error('Authentication required');
    const decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
    if (typeof decoded === 'string' || !isResourceId(decoded.id)) throw new Error('Invalid token');
    const user = await User.findById(decoded.id).select('_id name profileImage role isBanned status').lean();
    if (!user || user.isBanned) throw new Error('Authentication denied');
    return {
        id: String(user._id), name: user.name, role: user.role, status: user.status,
        avatar: typeof user.profileImage === 'string' && !user.profileImage.startsWith('data:') &&
            user.profileImage.length <= 2048 ? user.profileImage : ''
    };
}
