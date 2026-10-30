import mongoose, { Schema } from 'mongoose';
const schema = new Schema({
    roomId: { type: Schema.Types.ObjectId, ref: 'Room', required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true }
}, { timestamps: true });
schema.index({ roomId: 1, userId: 1 }, { unique: true });
schema.index({ userId: 1, roomId: 1 });
export default mongoose.model('Membership', schema);
