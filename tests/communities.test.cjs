const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createHarness } = require('./helpers/community-harness.cjs');
let harness, url, serverId, token, invitationId;
before(async () => {
    harness = createHarness();
    await new Promise(resolve => harness.server.listen(0, '127.0.0.1', resolve));
    url = 'http://127.0.0.1:' + harness.server.address().port;
});
after(async () => harness.close());
async function request(path, index = 0, method = 'GET', body) {
    return fetch(url + '/api' + path, { method, headers: {
        Authorization: 'Bearer ' + harness.token(harness.accounts[index]._id), 'Content-Type': 'application/json'
    }, ...(body ? { body: JSON.stringify(body) } : {}) });
}
test('new accounts start empty even when other public rooms exist', async () => {
    const created = await request('/rooms', 0, 'POST', { name: 'La sobremesa', isPrivate: false, communityType: 'friends' });
    assert.equal(created.status, 201); serverId = (await created.json())._id;
    assert.equal(harness.data.Membership.length, 0);
    assert.deepEqual(await (await request('/rooms', 1)).json(), []);
    assert.equal((await request('/rooms/' + serverId, 1)).status, 403);
    const own = await (await request('/rooms')).json();
    assert.equal(own.length, 1); assert.equal(own[0]._id, serverId);
});
test('only the owner can generate links and tokens are stored hashed', async () => {
    assert.equal((await request('/rooms/' + serverId + '/invite-links', 1, 'POST')).status, 403);
    const result = await request('/rooms/' + serverId + '/invite-links', 0, 'POST');
    assert.equal(result.status, 201); const link = await result.json(); token = link.token;
    assert.match(token, /^[a-f0-9]{64}$/);
    assert.equal(harness.data.Invitation[0].tokenHash, createHash('sha256').update(token).digest('hex'));
    assert.equal(harness.data.Invitation[0].token, undefined);
});
test('previewing does not join; accepting persists a single membership and grants access', async () => {
    const preview = await (await request('/invitations/preview/' + token, 1)).json();
    assert.equal(preview.room.name, 'La sobremesa'); assert.equal(preview.alreadyMember, false);
    assert.deepEqual(await (await request('/rooms', 1)).json(), []);
    assert.equal((await request('/invitations/join', 1, 'POST', { token })).status, 200);
    assert.equal((await request('/invitations/join', 1, 'POST', { token })).status, 200);
    assert.equal(harness.data.Membership.length, 1);
    assert.equal((await request('/rooms/' + serverId, 1)).status, 200);
    assert.equal((await (await request('/rooms', 1)).json()).length, 1);
});
test('revoked, expired and malformed links cannot admit another user', async () => {
    const link = harness.data.Invitation[0]; link.expiresAt = new Date(Date.now() - 1000);
    assert.equal((await request('/invitations/join', 2, 'POST', { token })).status, 404);
    link.expiresAt = new Date(Date.now() + 100000);
    assert.equal((await request('/rooms/' + serverId + '/invite-links/' + link._id, 1, 'DELETE')).status, 403);
    assert.equal((await request('/rooms/' + serverId + '/invite-links/' + link._id, 0, 'DELETE')).status, 200);
    assert.equal((await request('/invitations/preview/' + token, 2)).status, 404);
    assert.equal((await request('/invitations/join', 2, 'POST', { token: 'invalid' })).status, 404);
});
test('direct invitation enters only the recipient inbox without automatically joining', async () => {
    assert.equal((await request('/rooms/' + serverId + '/invitations', 1, 'POST', { recipientEmail: harness.accounts[2].email })).status, 403);
    const response = await request('/rooms/' + serverId + '/invitations', 0, 'POST', { recipientEmail: harness.accounts[2].email.toUpperCase() });
    assert.equal(response.status, 201); invitationId = (await response.json()).id;
    assert.deepEqual(await (await request('/invitations', 1)).json(), []);
    const inbox = await (await request('/invitations', 2)).json();
    assert.equal(inbox.length, 1); assert.equal(inbox[0].room._id, serverId);
    assert.equal(inbox[0].tokenHash, undefined);
    assert.deepEqual(await (await request('/rooms', 2)).json(), []);
});
test('another user cannot accept or decline an invitation addressed to someone else', async () => {
    assert.equal((await request('/invitations/' + invitationId + '/accept', 1, 'POST')).status, 404);
    assert.equal((await request('/invitations/' + invitationId + '/decline', 1, 'POST')).status, 404);
});
test('recipient can decline and a new invitation can subsequently be accepted idempotently', async () => {
    assert.equal((await request('/invitations/' + invitationId + '/decline', 2, 'POST')).status, 200);
    assert.deepEqual(await (await request('/invitations', 2)).json(), []);
    assert.deepEqual(await (await request('/rooms', 2)).json(), []);
    const next = await request('/rooms/' + serverId + '/invitations', 0, 'POST', { recipientEmail: harness.accounts[2].email });
    const nextId = (await next.json()).id;
    assert.equal((await request('/invitations/' + nextId + '/accept', 2, 'POST')).status, 200);
    assert.equal((await request('/invitations/' + nextId + '/accept', 2, 'POST')).status, 200);
    assert.equal(harness.data.Membership.filter(m => m.userId === harness.accounts[2]._id).length, 1);
    assert.equal((await request('/rooms/' + serverId, 2)).status, 200);
});
test('expired direct invitations and unauthenticated requests are rejected', async () => {
    const invitation = harness.data.Invitation.find(item => item.kind === 'direct');
    invitation.status = 'pending'; invitation.expiresAt = new Date(Date.now() - 1000);
    assert.equal((await request('/invitations/' + invitation._id + '/accept', 2, 'POST')).status, 404);
    assert.equal((await fetch(url + '/api/invitations')).status, 401);
});
