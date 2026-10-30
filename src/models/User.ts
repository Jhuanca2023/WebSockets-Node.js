import mongoose, { Schema, Document } from 'mongoose';

export enum UserRole {
    USER = 'USER',
    ADMIN = 'ADMIN'
}

export interface IUser extends Document {
    name: string;
    email: string;
    password: string;
    role: UserRole;
    isBanned: boolean;
    profileImage?: string;
    username?: string;
    bio?: string;
    status?: string;
    statusText?: string;
    bannerColor?: string;
    createdAt: Date;
}

const UserSchema: Schema = new Schema({
    username: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
    bio: { type: String, maxlength: 400, default: '' },
    status: { type: String, enum: ['online', 'idle', 'dnd', 'invisible'], default: 'online' },
    statusText: { type: String, maxlength: 80, default: '' },
    bannerColor: { type: String, default: '#6540b5' },
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: Object.values(UserRole), default: UserRole.USER },
    isBanned: { type: Boolean, default: false },
    profileImage: { type: String },
    createdAt: { type: Date, default: Date.now }
});

export default mongoose.model<IUser>('User', UserSchema);
