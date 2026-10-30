import mongoose from 'mongoose';
import 'dotenv/config';

export const connectDB = async () => {
    const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/chat-app';
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
    console.log(`Conexión a MongoDB establecida: ${mongoose.connection.name}`);
};
