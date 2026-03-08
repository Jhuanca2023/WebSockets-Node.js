import mongoose, { Schema, Document } from 'mongoose';

export interface IMessage extends Document {
    roomId: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    userName: string;
    content: string;
    type: string;
    fileUrl?: string;
    userAvatar?: string;
    reactions: Array<{ userId: mongoose.Types.ObjectId, emoji: string }>;
    recipientId?: mongoose.Types.ObjectId;
    isEdited: boolean;
    createdAt: Date;
}

const MessageSchema: Schema = new Schema({
    roomId: { type: Schema.Types.ObjectId, ref: 'Room', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    userName: { type: String }, // Store sender name for history
    content: { type: String, required: true },
    type: { type: String, enum: ['TEXT', 'FILE', 'AUDIO', 'SCREEN_SHARE'], default: 'TEXT' },
    userAvatar: { type: String }, // Store sender avatar for history
    fileUrl: { type: String },
    reactions: [{
        userId: { type: Schema.Types.ObjectId, ref: 'User' },
        emoji: String
    }],
    recipientId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    isEdited: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

export default mongoose.model<IMessage>('Message', MessageSchema);
