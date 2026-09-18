const bcrypt = require('bcryptjs');
const request = require('supertest');
const prisma = require('../src/lib/prisma');

// Creates a fresh org + user directly via Prisma (bypassing the invite flow's
// admin-permission requirement, which is appropriate for test setup — the
// invite flow itself is covered separately by hitting the real endpoint).
async function createOrgAndUser({ orgName, email, password, role }) {
  const org = await prisma.organization.create({ data: { name: orgName } });
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({
    data: { email, passwordHash, organizationId: org.id, role: role || 'admin' }
  });
  return { organization: org, user };
}

// Logs in through the real /api/auth/login endpoint (not a shortcut) and
// returns just the `radar_token=...` cookie value, ready to reuse as the
// Cookie header on subsequent requests.
async function loginAndGetCookie(app, email, password) {
  const res = await request(app).post('/api/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error('Test login failed: ' + JSON.stringify(res.body));
  const setCookie = res.headers['set-cookie'][0];
  return setCookie.split(';')[0];
}

// Deletes an org and everything under it, in FK-safe order — every test file
// creates its own dedicated org(s) and cleans them up in afterAll.
async function cleanupOrg(organizationId) {
  await prisma.sale.deleteMany({ where: { organizationId } });
  await prisma.customer.deleteMany({ where: { organizationId } });
  await prisma.product.deleteMany({ where: { organizationId } });
  await prisma.inventoryRecord.deleteMany({ where: { organizationId } });
  await prisma.auditLog.deleteMany({ where: { organizationId } });
  await prisma.user.deleteMany({ where: { organizationId } });
  await prisma.organization.delete({ where: { id: organizationId } });
}

module.exports = { createOrgAndUser, loginAndGetCookie, cleanupOrg };
