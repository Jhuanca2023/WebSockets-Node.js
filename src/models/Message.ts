import mongoose, { Schema, Document } from 'mongoose';

export interface IMessage extends Document {
    roomId: mongoose.Types.ObjectId;
    userId: mongoose.Types.ObjectId;
    content: string;
    isEdited: boolean;
    createdAt: Date;
}

const MessageSchema: Schema = new Schema({
    roomId: { type: Schema.Types.ObjectId, ref: 'Room', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    content: { type: String, required: true },
    isEdited: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

export default mongoose.model<IMessage>('Message', MessageSchema);
