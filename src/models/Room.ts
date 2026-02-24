import mongoose, { Schema, Document } from 'mongoose';

export interface IRoom extends Document {
    name: string;
    description: string;
    hostId: mongoose.Types.ObjectId;
    isPrivate: boolean;
    code: string;
    maxUsers: number;
    createdAt: Date;
}

const RoomSchema: Schema = new Schema({
    name: { type: String, required: true },
    description: { type: String },
    hostId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    isPrivate: { type: Boolean, default: false },
    code: { type: String, unique: true },
    maxUsers: { type: Number, default: 50 },
    createdAt: { type: Date, default: Date.now }
});

export default mongoose.model<IRoom>('Room', RoomSchema);
