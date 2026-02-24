import { Router } from 'express';
import { createRoom, getRooms, getRoomById } from './rooms.controller';
import { authMiddleware } from '../../middlewares/auth';

const router = Router();

router.use(authMiddleware);

router.post('/', createRoom);
router.get('/', getRooms);
router.get('/:id', getRoomById);

export default router;
