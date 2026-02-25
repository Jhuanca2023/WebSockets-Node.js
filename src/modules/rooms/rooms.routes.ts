import { Router } from 'express';
import { createRoom, getRooms, getRoomById, updateRoom, deleteRoom } from './rooms.controller';
import { authMiddleware } from '../../middlewares/auth';

const router = Router();

router.use(authMiddleware);

router.post('/', createRoom);
router.get('/', getRooms);
router.get('/:id', getRoomById);
router.put('/:id', updateRoom);
router.delete('/:id', deleteRoom);

export default router;
