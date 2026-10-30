import mongoose, { Schema, Document } from 'mongoose';

export interface IRoom extends Document {
    name: string;
    description: string;
    hostId: mongoose.Types.ObjectId;
    isPrivate: boolean;
    code?: string;
    maxUsers: number;
    imageUrl?: string;
    parentRoomId?: mongoose.Types.ObjectId;
    authorizedUsers?: mongoose.Types.ObjectId[];
    createdAt: Date;
    kind?: string;
    channelType?: 'text' | 'voice' | 'forum';
    directKey?: string;
    archived?: boolean;
    inheritAccess?: boolean;
    mutedUsers?: mongoose.Types.ObjectId[];
    permissions?: { sendMessages: boolean; sendAudio: boolean; sendFiles: boolean; shareScreen: boolean };
    communityType?: 'friends' | 'gaming' | 'creators';
}

const RoomSchema: Schema = new Schema({
    kind: { type: String, enum: ['community', 'direct'], default: 'community' },
    channelType: { type: String, enum: ['text', 'voice', 'forum'], default: 'text' },
    directKey: { type: String, unique: true, sparse: true },
    archived: { type: Boolean, default: false },
    inheritAccess: { type: Boolean, default: false },
    mutedUsers: [{ type: Schema.Types.ObjectId, ref: 'User' }],
    permissions: {
        sendMessages: { type: Boolean, default: true },
        sendAudio: { type: Boolean, default: true },
        sendFiles: { type: Boolean, default: true },
        shareScreen: { type: Boolean, default: true }
    },
    name: { type: String, required: true },
    description: { type: String },
    hostId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    isPrivate: { type: Boolean, default: false },
    communityType: { type: String, enum: ['friends', 'gaming', 'creators'], default: 'friends' },
    code: { type: String, unique: true, sparse: true },
    maxUsers: { type: Number, default: 50 },
    imageUrl: { type: String },
    parentRoomId: { type: Schema.Types.ObjectId, ref: 'Room' },
    authorizedUsers: [{ type: Schema.Types.ObjectId, ref: 'User' }], // ACL for sub-rooms
    createdAt: { type: Date, default: Date.now }
});

export default mongoose.model<IRoom>('Room', RoomSchema);
