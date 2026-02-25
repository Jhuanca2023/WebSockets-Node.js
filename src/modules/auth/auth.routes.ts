import { Router } from 'express';
import { register, login, updateProfile } from './auth.controller';
import { authMiddleware } from '../../middlewares/auth';

const router = Router();

router.post('/register', register);
router.post('/login', login);
router.put('/update-profile', authMiddleware, updateProfile);

export default router;
