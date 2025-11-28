import request from 'supertest';

// Ensure verification is off for tests and server doesn't listen
process.env.DISABLE_SIGNATURE_VERIFY = 'true';
process.env.NODE_ENV = 'test';

const now = Math.floor(Date.now()/1000);
function makeJwt(scopes = 'scim.read scim.write', sub = 'tester'){
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ sub, scope: scopes, iat: now, exp: now + 3600 })).toString('base64url');
  const sig = 'x';
  return `${header}.${payload}.${sig}`;
}

// Simple in-memory mock of the gRPC client
function createMockClient(){
  const store = new Map();
  return {
    listUsers(req, cb){
      const users = Array.from(store.values());
      cb(null, { users, total: users.length });
    },
    createUser(req, cb){
      const id = 'u-' + (store.size + 1);
      const u = { ...req.user, id };
      store.set(id, u);
      cb(null, { user: u });
    },
    getUser(req, cb){
      const u = store.get(req.id);
      if(!u) return cb(new Error('not found'));
      cb(null, { user: u });
    },
    updateUser(req, cb){
      const u = req.user;
      if(!store.has(u.id)) return cb(new Error('not found'));
      store.set(u.id, u);
      cb(null, { user: u });
    },
    deleteUser(req, cb){
      const existed = store.delete(req.id);
      cb(null, { deleted: existed });
    }
  };
}

// Import after env vars
import { app, setClient } from './index.js';

setClient(createMockClient());
const token = makeJwt();

describe('SCIM Service API', () => {
  test('GET /scim/v2/Users initially empty', async () => {
    const res = await request(app)
      .get('/scim/v2/Users')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.totalResults).toBe(0);
    expect(Array.isArray(res.body.Resources)).toBe(true);
  });

  test('POST /scim/v2/Users creates a user', async () => {
    const user = {
      userName: 'demoUser',
      name: { givenName: 'Demo', familyName: 'User' },
      emails: [{ value: 'demo@example.com' }]
    };
    const res = await request(app)
      .post('/scim/v2/Users')
      .set('Authorization', `Bearer ${token}`)
      .send(user)
      .expect(201);
    expect(res.body.userName).toBe('demoUser');
    expect(res.body.id).toMatch(/^u-/);
  });

  test('GET /scim/v2/Users returns created user', async () => {
    const res = await request(app)
      .get('/scim/v2/Users')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.totalResults).toBe(1);
    expect(res.body.Resources[0].userName).toBe('demoUser');
  });

  test('GET /scim/v2/Users/:id fetches user', async () => {
    const list = await request(app)
      .get('/scim/v2/Users')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const id = list.body.Resources[0].id;

    const res = await request(app)
      .get(`/scim/v2/Users/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body.id).toBe(id);
    expect(res.body.userName).toBe('demoUser');
  });

  test('PUT /scim/v2/Users/:id updates user', async () => {
    const list = await request(app)
      .get('/scim/v2/Users')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const id = list.body.Resources[0].id;

    const res = await request(app)
      .put(`/scim/v2/Users/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ userName: 'demoUser', name: { givenName: 'Updated', familyName: 'User' }, emails: [] })
      .expect(200);
    expect(res.body.name.givenName).toBe('Updated');
  });

  test('DELETE /scim/v2/Users/:id removes user', async () => {
    const list = await request(app)
      .get('/scim/v2/Users')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const id = list.body.Resources[0].id;

    await request(app)
      .delete(`/scim/v2/Users/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    await request(app)
      .get(`/scim/v2/Users/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });
});
