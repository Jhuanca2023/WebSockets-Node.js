import mongoose, { Schema } from 'mongoose';
const schema = new Schema({
    roomId: { type: Schema.Types.ObjectId, ref: 'Room', required: true },
    inviterId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    recipientId: { type: Schema.Types.ObjectId, ref: 'User' },
    kind: { type: String, enum: ['link', 'direct'], required: true },
    tokenHash: { type: String },
    status: { type: String, enum: ['pending', 'accepted', 'declined', 'revoked'], default: 'pending' },
    expiresAt: { type: Date, required: true }
}, { timestamps: true });
schema.index({ tokenHash: 1 }, { unique: true, sparse: true });
schema.index({ recipientId: 1, status: 1, expiresAt: 1 });
schema.index({ roomId: 1, recipientId: 1 }, {
    unique: true, partialFilterExpression: { kind: 'direct', status: 'pending' }
});
export default mongoose.model('Invitation', schema);
