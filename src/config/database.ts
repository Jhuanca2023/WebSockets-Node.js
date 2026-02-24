import mongoose from 'mongoose';
import dotenv from 'dotenv';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/chat-app';

export const connectDB = async () => {
    try {
        await mongoose.connect(MONGODB_URI);
        console.log('✅ Conexión a MongoDB establecida');
    } catch (error) {
        console.error('❌ Error al conectar a MongoDB:', error);
        process.exit(1);
    }
};
