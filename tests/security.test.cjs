const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const express = require('express');
const { Server } = require('socket.io');
const { io } = require('socket.io-client');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
process.env.JWT_SECRET = 'test-access-key-only-not-for-production-123456';
process.env.JWT_REFRESH_SECRET = 'test-refresh-key-only-not-for-production-654321';
const Room = require('../dist/models/Room').default;
const User = require('../dist/models/User').default;
const Message = require('../dist/models/Message').default;
const Membership = require('../dist/models/Membership').default;
const { canAccessRoom } = require('../dist/modules/rooms/room-access');
const { authMiddleware, adminMiddleware } = require('../dist/middlewares/auth');
const { getRoomById, getRoomMessages, createRoom } = require('../dist/modules/rooms/rooms.controller');
const { socketHandler } = require('../dist/sockets/socket.handler');
const id = n => n.toString(16).padStart(24, '0');
const owner = id(1), member = id(2), outsider = id(3), banned = id(4);
const publicId = id(10), privateId = id(11), childId = id(12), otherId = id(13);
const users = new Map([owner, member, outsider, banned].map(value => [value, {
    _id: value, name: value, role: 'USER', isBanned: value === banned
}]));
const rooms = new Map([
    [publicId, { _id: publicId, hostId: owner, isPrivate: false }],
    [privateId, { _id: privateId, hostId: owner, isPrivate: true, authorizedUsers: [member] }],
    [childId, { _id: childId, hostId: owner, isPrivate: false, parentRoomId: privateId, authorizedUsers: [member] }],
    [otherId, { _id: otherId, hostId: owner, isPrivate: false }]
]);
const messages = [];
let counter = 100;
const query = value => ({
    then(resolve, reject) { return Promise.resolve(value).then(resolve, reject); },
    select() { return this; }, populate() { return this; }, lean() { return Promise.resolve(value); }
});
const matches = (doc, filter) => Object.entries(filter).every(([key, value]) => {
    if (key === '$or') return value.some(clause => matches(doc, clause));
    if (value === null) return doc[key] == null;
    if (value && typeof value === 'object' && '$lt' in value) return String(doc[key]) < String(value.$lt);
    return String(doc[key]) === String(value);
});
const originals = [];
function replace(target, key, value) { originals.push([target, key, target[key]]); target[key] = value; }
const document = draft => ({ ...draft, _id: id(counter++), createdAt: new Date(), reactions: [],
    toObject() { const { toObject, ...plain } = this; return plain; }
});
let server, sio, url;
const clients = [];
const token = value => jwt.sign({ id: value, role: 'ADMIN' }, process.env.JWT_SECRET, { expiresIn: '1h' });
async function connect(value) {
    const client = io(url, { auth: { token: token(value) }, transports: ['websocket'], reconnection: false });
    clients.push(client);
    await new Promise((resolve, reject) => { client.once('connect', resolve); client.once('connect_error', reject); });
    return client;
}
const emit = (client, event, data) => client.timeout(3000).emitWithAck(event, data);
const payload = (roomId, extra = {}) => ({ roomId, content: 'hello', type: 'TEXT', ...extra });
async function request(path, value, options = {}) {
    return fetch(url + path, { ...options, headers: { Authorization: 'Bearer ' + token(value),
        'Content-Type': 'application/json', ...options.headers } });
}
const wait = () => new Promise(resolve => setTimeout(resolve, 50));

before(async () => {
    replace(Membership, 'exists', filter => Promise.resolve(
        [publicId, otherId].includes(String(filter.roomId)) && [owner, member, outsider].includes(String(filter.userId))
            ? { _id: id(900) } : null));
    replace(Room, 'findById', value => query(rooms.get(String(value)) ?? null));
    replace(User, 'findById', value => query(users.get(String(value)) ?? null));
    replace(Message, 'find', filter => ({ sort() { return this; }, limit(limit) {
        return Promise.resolve(messages.filter(message => matches(message, filter))
            .sort((a, b) => String(b._id).localeCompare(String(a._id))).slice(0, limit));
    } }));
    replace(Message, 'findOne', filter => Promise.resolve(messages.find(message => matches(message, filter)) ?? null));
    replace(Message, 'create', async draft => {
        if (draft.clientMessageId && messages.some(m => m.userId === draft.userId && m.clientMessageId === draft.clientMessageId)) {
            throw Object.assign(new Error('duplicate'), { code: 11000 });
        }
        const message = document(draft); messages.push(message); return message;
    });
    replace(Message, 'updateOne', async (filter, update) => {
        const message = messages.find(m => String(m._id) === String(filter._id));
        const reaction = update.$push.reactions;
        if (message.reactions.some(r => r.userId === reaction.userId && r.emoji === reaction.emoji)) return { modifiedCount: 0 };
        message.reactions.push(reaction); return { modifiedCount: 1 };
    });
    const app = express(); app.use(express.json());
    app.get('/rooms/:id', authMiddleware, getRoomById);
    app.get('/rooms/:id/messages', authMiddleware, getRoomMessages);
    app.post('/rooms', authMiddleware, createRoom);
    app.get('/internal', authMiddleware, adminMiddleware, (_, res) => res.json({ ok: true }));
    server = createServer(app); sio = new Server(server); socketHandler(sio);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    url = 'http://127.0.0.1:' + server.address().port;
});
after(async () => {
    clients.forEach(client => client.disconnect());
    await new Promise(resolve => sio.close(resolve));
    originals.reverse().forEach(([target, key, original]) => target[key] = original);
});

test('private roots and child ACLs reject outsiders, including orphaned/cyclic ancestry', async () => {
    assert.equal(await canAccessRoom(rooms.get(privateId), outsider), false);
    assert.equal(await canAccessRoom(rooms.get(privateId), member), true);
    assert.equal(await canAccessRoom(rooms.get(childId), member), true);
    assert.equal(await canAccessRoom(rooms.get(childId), outsider), false);
    assert.equal(await canAccessRoom({ _id: id(70), hostId: owner, parentRoomId: id(71) }, owner), false);
    const cyclic = { _id: id(72), hostId: owner, parentRoomId: id(72) }; rooms.set(cyclic._id, cyclic);
    assert.equal(await canAccessRoom(cyclic, owner), false);
});

test('REST enforces root privacy, child ACL and invalid IDs', async () => {
    assert.equal((await request('/rooms/' + privateId, outsider)).status, 403);
    assert.equal((await request('/rooms/' + childId + '/messages', outsider)).status, 403);
    assert.equal((await request('/rooms/' + privateId, member)).status, 200);
    assert.equal((await request('/rooms/invalid', member)).status, 400);
});

test('banned and deleted users cannot authenticate; token roles are not trusted', async () => {
    assert.equal((await request('/rooms/' + publicId, banned)).status, 401);
    assert.equal((await request('/rooms/' + publicId, id(99))).status, 401);
    assert.equal((await request('/internal', owner)).status, 403);
    await assert.rejects(connect(banned));
});

test('outsiders cannot create a child under somebody else\'s community', async () => {
    const response = await request('/rooms', outsider, { method: 'POST', body: JSON.stringify({ name: 'injected', parentRoomId: publicId }) });
    assert.equal(response.status, 403);
});

test('socket access and send enforce ACL, join and target IDs', async () => {
    const client = await connect(outsider);
    assert.equal((await emit(client, 'join-room', { roomId: privateId })).code, 'FORBIDDEN');
    assert.equal((await emit(client, 'send-message', payload(privateId))).code, 'FORBIDDEN');
    assert.equal((await emit(client, 'send-message', payload(publicId))).code, 'NOT_JOINED');
    assert.equal((await emit(client, 'join-room', { roomId: 'invalid' })).code, 'INVALID_INPUT');
    client.disconnect();
});

test('private messages and reactions reach participants only, including REST history', async () => {
    const sender = await connect(owner), recipient = await connect(member), third = await connect(outsider);
    await Promise.all([sender, recipient, third].map(c => emit(c, 'join-room', { roomId: publicId })));
    const received = [[], [], []], reactions = [[], [], []];
    [sender, recipient, third].forEach((c, i) => {
        c.on('receive-message', message => received[i].push(message));
        c.on('message-reaction', reaction => reactions[i].push(reaction));
    });
    const result = await emit(sender, 'send-message', payload(publicId, { recipientId: member, clientMessageId: 'private-message-0001' }));
    assert.equal(result.ok, true); await wait();
    assert.equal(received[0].length, 1); assert.equal(received[1].length, 1); assert.equal(received[2].length, 0);
    const thirdHistory = await (await request('/rooms/' + publicId + '/messages', outsider)).json();
    assert.equal(thirdHistory.some(m => m._id === result.messageId), false);
    const ownHistory = await (await request('/rooms/' + publicId + '/messages', member)).json();
    assert.equal(ownHistory.some(m => m._id === result.messageId), true);
    assert.equal((await emit(third, 'send-reaction', { roomId: publicId, messageId: result.messageId, emoji: '👍' })).code, 'FORBIDDEN');
    assert.equal((await emit(recipient, 'send-reaction', { roomId: publicId, messageId: result.messageId, emoji: '👍' })).ok, true);
    await wait(); assert.equal(reactions[0].length, 1); assert.equal(reactions[1].length, 1); assert.equal(reactions[2].length, 0);
    [sender, recipient, third].forEach(c => c.disconnect());
});

test('retries deduplicate and conflicting payloads cannot reuse an ID', async () => {
    const client = await connect(owner); await emit(client, 'join-room', { roomId: publicId });
    const data = payload(publicId, { clientMessageId: 'dedup-message-00001' });
    const first = await emit(client, 'send-message', data), retry = await emit(client, 'send-message', data);
    assert.equal(first.ok, true); assert.equal(first.messageId, retry.messageId);
    assert.equal(messages.filter(m => m.clientMessageId === data.clientMessageId).length, 1);
    assert.equal((await emit(client, 'send-message', { ...data, content: 'different' })).code, 'CONFLICT');
    assert.equal((await emit(client, 'send-reaction', { roomId: otherId, messageId: first.messageId, emoji: '👍' })).code, 'FORBIDDEN');
    client.disconnect();
});

test('changing room leaves previous subscriptions and repeated reactions are deduplicated', async () => {
    const sender = await connect(owner), switching = await connect(member);
    await emit(sender, 'join-room', { roomId: publicId });
    await emit(switching, 'join-room', { roomId: publicId });
    await emit(switching, 'join-room', { roomId: otherId });
    const received = []; switching.on('receive-message', message => received.push(message));
    const result = await emit(sender, 'send-message', payload(publicId));
    await wait(); assert.equal(received.length, 0);
    const reaction = { roomId: publicId, messageId: result.messageId, emoji: '👍' };
    await emit(sender, 'send-reaction', reaction); await emit(sender, 'send-reaction', reaction);
    assert.equal(messages.find(m => m._id === result.messageId).reactions.length, 1);
    sender.disconnect(); switching.disconnect();
});

test('ACL revocation and bans stop delivery and commands on existing sockets', async () => {
    const sender = await connect(owner), recipient = await connect(member);
    await emit(sender, 'join-room', { roomId: privateId });
    await emit(recipient, 'join-room', { roomId: privateId });
    const received = []; recipient.on('receive-message', message => received.push(message));
    rooms.get(privateId).authorizedUsers = [];
    try {
        assert.equal((await emit(sender, 'send-message', payload(privateId))).ok, true);
        await wait(); assert.equal(received.length, 0);
        assert.equal((await emit(recipient, 'send-message', payload(privateId))).code, 'FORBIDDEN');
        users.get(member).isBanned = true;
        assert.equal((await emit(recipient, 'join-room', { roomId: publicId })).ok, false);
    } finally {
        rooms.get(privateId).authorizedUsers = [member]; users.get(member).isBanned = false;
        sender.disconnect(); recipient.disconnect();
    }
});

test('history returns the latest 500 in ascending order, with an older-page cursor', async () => {
    for (let i = 0; i < 510; i++) messages.push(document({ roomId: otherId, userId: owner, content: String(i), recipientId: null }));
    const response = await request('/rooms/' + otherId + '/messages', member);
    const page = await response.json();
    assert.equal(page.length, 500); assert.equal(page[0].content, '10'); assert.equal(page[499].content, '509');
    const earlier = await (await request('/rooms/' + otherId + '/messages?before=' + page[0]._id, member)).json();
    assert.equal(earlier.length, 10); assert.equal(earlier[0].content, '0');
});

test('missing, weak and identical signing secrets fail closed at startup', () => {
    const { spawnSync } = require('node:child_process');
    for (const [access, refresh] of [['', ''], ['secret', 'refresh_secret'], ['x'.repeat(40), 'x'.repeat(40)]]) {
        const child = spawnSync(process.execPath, ['-e', "require('./dist/config/security')"], {
            cwd: require('node:path').resolve(__dirname, '..'),
            env: { ...process.env, JWT_SECRET: access, JWT_REFRESH_SECRET: refresh }, encoding: 'utf8'
        });
        assert.notEqual(child.status, 0);
        assert.match(child.stderr, /JWT_SECRET/);
    }
});
