import mongoose, { Schema, Document } from 'mongoose';

export interface IRoom extends Document {
    name: string;
    description: string;
    hostId: mongoose.Types.ObjectId;
    isPrivate: boolean;
    code: string;
    maxUsers: number;
    imageUrl?: string;
    parentRoomId?: mongoose.Types.ObjectId;
    authorizedUsers?: mongoose.Types.ObjectId[];
    createdAt: Date;
}

const RoomSchema: Schema = new Schema({
    name: { type: String, required: true },
    description: { type: String },
    hostId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    isPrivate: { type: Boolean, default: false },
    code: { type: String, unique: true, sparse: true },
    maxUsers: { type: Number, default: 50 },
    imageUrl: { type: String },
    parentRoomId: { type: Schema.Types.ObjectId, ref: 'Room' },
    authorizedUsers: [{ type: Schema.Types.ObjectId, ref: 'User' }], // ACL for sub-rooms
    createdAt: { type: Date, default: Date.now }
});

export default mongoose.model<IRoom>('Room', RoomSchema);
