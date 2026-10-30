const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { randomBytes, randomUUID } = require('node:crypto');
const net = require('node:net');
const mongoose = require('mongoose');
const { io } = require('socket.io-client');
const path = require('node:path');

test('MongoDB real: cuentas, invitaciones, permisos, sockets, índices y reinicio', { timeout: 90000 }, async t => {
  // Exclusively disposable loopback database; never use the application URI here.
  const database = 'webrocket_test_' + randomBytes(12).toString('hex');
  const uri = 'mongodb://127.0.0.1:27017/' + database;
  const db = await mongoose.createConnection(uri, { serverSelectionTimeoutMS: 5000 }).asPromise();
  const reservation = net.createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const origin = 'http://127.0.0.1:' + port;
  const env = { ...process.env, MONGODB_URI: uri, PORT: String(port), JWT_SECRET: randomBytes(48).toString('hex'), JWT_REFRESH_SECRET: randomBytes(48).toString('hex') };
  let child;
  let logs = '';
  const sockets = [];
  async function stop() {
    if (!child || child.exitCode !== null) return;
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  }
  t.after(async () => {
    sockets.forEach(socket => socket.disconnect());
    await stop();
    assert.match(db.name, /^webrocket_test_[a-f0-9]{24}$/);
    await db.dropDatabase();
    await db.close();
  });
  async function start() {
    child = spawn(process.execPath, ['dist/index.js'], { cwd: path.resolve(__dirname, '..'), env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', chunk => { logs += chunk; });
    child.stderr.on('data', chunk => { logs += chunk; });
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error('Backend no inició: ' + logs);
      try { if ((await fetch(origin + '/health')).ok) return; } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Timeout iniciando backend: ' + logs);
  }
  async function api(route, token, body, expected = 200, method = body === undefined ? 'GET' : 'POST') {
    const response = await fetch(origin + '/api' + route, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const result = await response.json();
    assert.equal(response.status, expected, route + ': ' + JSON.stringify(result));
    return result;
  }
  async function account(name) {
    const email = name.toLowerCase() + '@webrocket.test';
    const password = randomBytes(24).toString('hex');
    await api('/auth/register', null, { name, email, password }, 201);
    return { email, ...await api('/auth/login', null, { email, password }) };
  }
  async function socketFor(user) {
    const socket = io(origin, { auth: { token: user.accessToken }, transports: ['websocket'], reconnection: false, timeout: 5000 });
    sockets.push(socket);
    await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
    return socket;
  }
  const ack = (socket, event, body) => socket.timeout(5000).emitWithAck(event, body);
  await start();
  const ana = await account('Ana');
  const bruno = await account('Bruno');
  const carla = await account('Carla');
  assert.deepEqual(await api('/rooms', bruno.accessToken), []);
  const room = await api('/rooms', ana.accessToken, { name: 'Integración MongoDB', isPrivate: true }, 201);
  await api('/rooms/' + room._id, bruno.accessToken, undefined, 403);
  const link = await api('/rooms/' + room._id + '/invite-links', ana.accessToken, {}, 201);
  const preview = await api('/invitations/preview/' + link.token, carla.accessToken);
  assert.equal(preview.alreadyMember, false);
  assert.deepEqual(await api('/rooms', carla.accessToken), []);
  await Promise.all(Array.from({ length: 4 }, () => api('/invitations/join', carla.accessToken, { token: link.token })));
  assert.equal(await db.collection('memberships').countDocuments({ userId: new mongoose.Types.ObjectId(carla.user.id) }), 1);
  const invitation = await api('/rooms/' + room._id + '/invitations', ana.accessToken, { recipientEmail: bruno.email }, 201);
  assert.equal((await api('/invitations', bruno.accessToken)).length, 1);
  await api('/invitations/' + invitation.id + '/accept', carla.accessToken, {}, 404);
  await api('/invitations/' + invitation.id + '/accept', bruno.accessToken, {});
  assert.equal((await api('/rooms', bruno.accessToken))[0]._id, room._id);
  const sender = await socketFor(ana);
  const receiver = await socketFor(bruno);
  assert.equal((await ack(sender, 'join-room', { roomId: room._id })).ok, true);
  assert.equal((await ack(receiver, 'join-room', { roomId: room._id })).ok, true);
  const received = new Promise((resolve, reject) => { const timeout = setTimeout(() => reject(new Error('Mensaje no recibido')), 5000); receiver.once('receive-message', message => { clearTimeout(timeout); resolve(message); }); });
  const draft = { roomId: room._id, content: 'Mensaje persistido en MongoDB', clientMessageId: randomUUID() };
  const first = await ack(sender, 'send-message', draft);
  assert.equal(first.ok, true);
  assert.equal((await received).content, draft.content);
  assert.equal((await ack(sender, 'send-message', draft)).messageId, first.messageId);
  assert.equal(await db.collection('messages').countDocuments({ clientMessageId: draft.clientMessageId }), 1);
  for (const collection of ['memberships', 'invitations', 'messages']) {
    assert.ok((await db.collection(collection).indexes()).some(index => index.unique && index.name !== '_id_'), collection + ' requiere índice único');
  }
  await assert.rejects(db.collection('memberships').insertOne({ roomId: new mongoose.Types.ObjectId(room._id), userId: new mongoose.Types.ObjectId(carla.user.id) }), { code: 11000 });
  await api('/rooms/' + room._id + '/invite-links/' + link.id, ana.accessToken, undefined, 200, 'DELETE');
  await api('/invitations/preview/' + link.token, carla.accessToken, undefined, 404);
  await api('/auth/update-profile', bruno.accessToken, {username:'bruno_test',bio:'Juego y desarrollo',status:'dnd',statusText:'Concentrado',bannerColor:'#6540b5'}, 200, 'PUT');
  const members = await api('/rooms/' + room._id + '/members', ana.accessToken);
  assert.equal(members.find(member => member._id === bruno.user.id).bio, 'Juego y desarrollo');
  assert.ok(members.every(member => !('email' in member) && !('password' in member)));
  const channel = await api('/rooms', ana.accessToken, {name:'Equipo privado',parentRoomId:room._id,isPrivate:true,channelType:'voice'},201);
  assert.equal(channel.channelType,'voice');
  await api('/rooms', ana.accessToken, {name:'Tipo inválido',parentRoomId:room._id,channelType:'telepatia'},400);
  await api('/rooms/' + channel._id, bruno.accessToken, undefined,403);
  const channelInvite = await api('/rooms/' + channel._id + '/invitations', ana.accessToken, {username:'bruno_test'},201);
  await api('/invitations/' + channelInvite.id + '/accept',bruno.accessToken,{});
  await api('/rooms/' + channel._id,bruno.accessToken);
  await api('/rooms/' + channel._id,carla.accessToken,undefined,403);
  const dm = await api('/rooms/' + room._id + '/direct',ana.accessToken,{recipientId:bruno.user.id});
  const sameDm = await api('/rooms/' + room._id + '/direct',bruno.accessToken,{recipientId:ana.user.id});
  assert.equal(dm._id,sameDm._id);
  await api('/rooms/' + dm._id,carla.accessToken,undefined,403);
  await api('/rooms/' + dm._id,ana.accessToken,{authorizedUsers:[carla.user.id]},403,'PUT');
  await api('/rooms/' + room._id,bruno.accessToken,{permissions:{sendAudio:false}},403,'PUT');
  await api('/rooms/' + room._id,ana.accessToken,{permissions:{sendAudio:false,shareScreen:false}},200,'PUT');
  assert.equal((await ack(receiver,'send-message',{roomId:room._id,type:'AUDIO',content:'audio bloqueado'})).ok,false);
  assert.equal((await ack(receiver,'media-start',{roomId:room._id,mode:'screen'})).ok,false);
  await api('/rooms/' + room._id + '/members/' + bruno.user.id + '/mute',ana.accessToken,{muted:true},200,'PUT');
  assert.equal((await ack(receiver,'send-message',{roomId:room._id,content:'silenciado'})).ok,false);
  await api('/rooms/' + room._id + '/members/' + bruno.user.id + '/mute',ana.accessToken,{muted:false},200,'PUT');
  const typed = new Promise(resolve => receiver.once('typing',resolve));
  await ack(sender,'typing',{roomId:room._id,active:true});
  assert.equal((await typed).name,'Ana');
  assert.equal((await ack(sender,'media-start',{roomId:room._id,mode:'screen'})).ok,true);
  const viewerJoined = new Promise(resolve=>receiver.once('media-streams',resolve));
  assert.equal((await ack(receiver,'media-watch',{publisher:sender.id})).ok,true);
  assert.equal((await viewerJoined).find(stream=>stream.socketId===sender.id).viewerCount,1);
  const signaled = new Promise(resolve=>receiver.once('media-signal',resolve));
  assert.equal((await ack(sender,'media-signal',{target:receiver.id,signal:{description:{type:'offer',sdp:'test-only'}}})).ok,true);
  assert.equal((await signaled).from,sender.id);
  const viewerLeft = new Promise(resolve=>receiver.once('media-streams',resolve));
  assert.equal((await ack(receiver,'media-unwatch',{publisher:sender.id})).ok,true);
  assert.equal((await viewerLeft).find(stream=>stream.socketId===sender.id).viewerCount,0);
  await ack(sender,'media-stop',{});
  await api('/rooms/' + room._id,ana.accessToken,{archived:true},200,'PUT');
  assert.equal((await ack(sender,'send-message',{roomId:room._id,content:'cerrado'})).ok,false);
  await api('/rooms/' + room._id + '/invite-links',ana.accessToken,{},403);
  sockets.forEach(socket => socket.disconnect());
  await stop();
  await start();
  assert.equal((await api('/rooms', bruno.accessToken))[0]._id, room._id);
  const history = await api('/rooms/' + room._id + '/messages', bruno.accessToken);
  assert.equal(history.length, 1);
  assert.equal(history[0].content, draft.content);
  t.diagnostic('Persistencia confirmada después de reiniciar Node; base temporal eliminada al finalizar.');
});
