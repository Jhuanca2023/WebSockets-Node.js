// Test-only persistence doubles. Never imported by the application entry point.
const express = require('express');
const cors = require('cors');
const { createServer } = require('node:http');
const jwt = require('jsonwebtoken');
process.env.JWT_SECRET = 'test-community-access-only-12345678901234567890';
process.env.JWT_REFRESH_SECRET = 'test-community-refresh-only-09876543210987654321';
const Room = require('../../dist/models/Room').default;
const User = require('../../dist/models/User').default;
const Membership = require('../../dist/models/Membership').default;
const Invitation = require('../../dist/models/Invitation').default;
const roomRoutes = require('../../dist/modules/rooms/rooms.routes').default;
const invitationRoutes = require('../../dist/modules/invitations/invitations.routes').default;
const id = n => n.toString(16).padStart(24, '0');
const same = (a, b) => String(a?._id ?? a) === String(b?._id ?? b);
function matches(doc, filter) {
    return Object.entries(filter).every(([key, value]) => {
        if (key === '$or') return value.some(clause => matches(doc, clause));
        const actual = doc[key];
        if (value instanceof RegExp) return value.test(actual ?? '');
        if (value === null) return actual == null;
        if (value && typeof value === 'object' && '$in' in value) return value.$in.some(item => same(actual, item));
        if (value && typeof value === 'object' && '$gt' in value) return actual > value.$gt;
        if (Array.isArray(actual)) return actual.some(item => same(item, value));
        return same(actual, value);
    });
}
function createHarness() {
    const data = { Room: [], User: [], Membership: [], Invitation: [] };
    let counter = 1000;
    const restore = [];
    const replace = (model, key, fn) => { restore.push(() => model[key] = original); const original = model[key]; model[key] = fn; };
    function make(name, values) {
        const doc = { _id: id(counter++), createdAt: new Date(), ...values };
        if (name === 'Room') { doc.isPrivate ??= true; doc.authorizedUsers ??= []; }
        if (name === 'Invitation') doc.status ??= 'pending';
        Object.defineProperty(doc, 'save', { value: async () => doc });
        data[name].push(doc); return doc;
    }
    function query(value) {
        let result = value;
        return {
            select() { return this; },
            populate(field) {
                const transform = doc => {
                    if (!doc) return doc;
                    const references = { hostId: 'User', roomId: 'Room', inviterId: 'User' };
                    const reference = data[references[field]]?.find(item => same(item._id, doc[field]));
                    if (!reference) return { ...doc, [field]: null };
                    const { _id, name, description, imageUrl, profileImage } = reference;
                    return { ...doc, [field]: { _id, name, description, imageUrl, profileImage } };
                };
                result = Array.isArray(result) ? result.map(transform) : transform(result); return this;
            },
            sort(order) {
                const [field, direction] = Object.entries(order)[0];
                if (Array.isArray(result)) result = [...result].sort((a, b) => a[field] > b[field] ? direction : -direction);
                return this;
            },
            limit(limit) { if (Array.isArray(result)) result = result.slice(0, limit); return this; },
            lean() { return Promise.resolve(result); },
            then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); }
        };
    }
    for (const [name, model] of Object.entries({ Room, User, Membership, Invitation })) {
        replace(model, 'findById', value => query(data[name].find(doc => same(doc._id, value)) ?? null));
        replace(model, 'findOne', filter => query(data[name].find(doc => matches(doc, filter)) ?? null));
        replace(model, 'find', filter => query(data[name].filter(doc => matches(doc, filter))));
        replace(model, 'exists', filter => query(data[name].some(doc => matches(doc, filter)) ? { _id: id(1) } : null));
        replace(model, 'create', async values => make(name, values));
        replace(model, 'updateOne', async (filter, update, options = {}) => {
            let doc = data[name].find(doc => matches(doc, filter));
            const existed = !!doc;
            if (!doc && options.upsert) doc = make(name, { ...filter, ...update.$setOnInsert });
            if (doc) Object.assign(doc, update.$set);
            return { matchedCount: existed ? 1 : 0, modifiedCount: existed ? 1 : 0, upsertedCount: !existed && doc ? 1 : 0 };
        });
        replace(model, 'findOneAndUpdate', async (filter, update, options = {}) => {
            let doc = data[name].find(doc => matches(doc, filter));
            if (!doc && options.upsert) doc = make(name, { ...filter, ...update.$setOnInsert });
            if (doc) Object.assign(doc, update.$set);
            return doc;
        });
    }
    const accounts = [
        { _id: id(1), name: 'Ana Torres', email: 'ana@webrocket.test' },
        { _id: id(2), name: 'Bruno Díaz', email: 'bruno@webrocket.test' },
        { _id: id(3), name: 'Carla Ruiz', email: 'carla@webrocket.test' }
    ];
    accounts.forEach(user => data.User.push({ ...user, role: 'USER', isBanned: false }));
    const app = express(); app.use(cors({ origin: ['http://127.0.0.1:4200', 'http://localhost:4200'] })); app.use(express.json());
    const token = userId => jwt.sign({ id: userId, role: 'USER' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    app.post('/api/auth/login', (req, res) => {
        const user = data.User.find(user => user.email === req.body.email);
        if (!user || req.body.password !== 'preview-only') return res.status(401).json({ message: 'Cuenta de prueba no válida' });
        return res.json({ user: { id: user._id, name: user.name, email: user.email, role: user.role },
            accessToken: token(user._id), refreshToken: 'test-only' });
    });
    app.use('/api/rooms', roomRoutes); app.use('/api/invitations', invitationRoutes);
    const server = createServer(app);
    return { data, accounts, token, server, close: async () => {
        await new Promise(resolve => server.close(resolve)); restore.reverse().forEach(fn => fn());
    } };
}
module.exports = { createHarness, id };
if (require.main === module) {
    if (process.env.WEBROCKET_QA !== '1') throw new Error('Solo para QA local: define WEBROCKET_QA=1');
    const harness = createHarness();
    harness.server.listen(3000, '127.0.0.1', () => console.log('QA local, datos simulados: ana@webrocket.test / preview-only'));
}
