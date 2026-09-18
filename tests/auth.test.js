// Mocked so the forgot-password test can read the raw reset token straight out
// of the (never actually sent) email content, instead of scraping console output.
jest.mock('../src/lib/email', () => ({ sendEmail: jest.fn().mockResolvedValue({ delivered: true }) }));

const request = require('supertest');
const app = require('../src/server');
const prisma = require('../src/lib/prisma');
const { sendEmail } = require('../src/lib/email');
const { createOrgAndUser, cleanupOrg } = require('./helpers');

describe('auth', () => {
  let org, user;
  const password = 'correct-horse-1234';

  beforeAll(async () => {
    ({ organization: org, user } = await createOrgAndUser({
      orgName: 'Auth Test Org', email: 'auth-test@example.com', password
    }));
  });

  afterAll(async () => {
    await cleanupOrg(org.id);
    await prisma.$disconnect();
  });

  test('rejects login with missing fields', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: user.email });
    expect(res.status).toBe(400);
  });

  test('rejects login with wrong password', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: user.email, password: 'wrong' });
    expect(res.status).toBe(401);
  });

  test('accepts login with correct credentials and sets a cookie', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: user.email, password });
    expect(res.status).toBe(200);
    expect(res.headers['set-cookie'][0]).toMatch(/^radar_token=/);
  });

  test('rejects /me without a cookie', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  test('accepts /me with a valid cookie', async () => {
    const loginRes = await request(app).post('/api/auth/login').send({ email: user.email, password });
    const cookie = loginRes.headers['set-cookie'][0];
    const res = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(user.email);
  });

  test('full forgot-password / reset-password flow', async () => {
    const forgotRes = await request(app).post('/api/auth/forgot-password').send({ email: user.email });
    expect(forgotRes.status).toBe(200);
    expect(sendEmail).toHaveBeenCalled();

    const html = sendEmail.mock.calls[sendEmail.mock.calls.length - 1][0].html;
    const token = html.match(/token=([a-f0-9]+)/)[1];

    const newPassword = 'brand-new-password-5678';
    const resetRes = await request(app).post('/api/auth/reset-password').send({ token, newPassword });
    expect(resetRes.status).toBe(200);

    const oldLogin = await request(app).post('/api/auth/login').send({ email: user.email, password });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app).post('/api/auth/login').send({ email: user.email, password: newPassword });
    expect(newLogin.status).toBe(200);

    // The token was single-use — trying it again must fail.
    const reuseRes = await request(app).post('/api/auth/reset-password').send({ token, newPassword: 'yet-another-pass-9999' });
    expect(reuseRes.status).toBe(400);
  });

  test('rejects reset-password with an invalid token', async () => {
    const res = await request(app).post('/api/auth/reset-password').send({ token: 'not-a-real-token', newPassword: 'whatever12345' });
    expect(res.status).toBe(400);
  });
});
