const request = require('supertest');
const app = require('../src/server');
const prisma = require('../src/lib/prisma');
const { createOrgAndUser, loginAndGetCookie, cleanupOrg } = require('./helpers');

describe('sales upload', () => {
  let org, user, cookie;

  beforeAll(async () => {
    ({ organization: org, user } = await createOrgAndUser({
      orgName: 'Upload Test Org', email: 'upload-test@example.com', password: 'upload-test-pass-1234'
    }));
    cookie = await loginAndGetCookie(app, user.email, 'upload-test-pass-1234');
  });

  afterAll(async () => {
    await cleanupOrg(org.id);
    await prisma.$disconnect();
  });

  test('rejects a disallowed file type with a clean JSON error', async () => {
    const res = await request(app)
      .post('/api/sales/upload')
      .set('Cookie', cookie)
      .attach('file', Buffer.from('not a real spreadsheet'), 'malware.exe');
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
  });

  test('accepts a valid CSV and completes via the async job flow', async () => {
    const csv = 'מספר לקוח,שם לקוח,קוד פריט,שם פריט,שנה,חודש,מכר כספי,מכר כמותי,משקל\n' +
      'TEST-C1,לקוח בדיקה,TEST-P1,מוצר בדיקה,2026,5,150,3,1.5\n';
    const uploadRes = await request(app)
      .post('/api/sales/upload')
      .set('Cookie', cookie)
      .attach('file', Buffer.from(csv, 'utf8'), 'sales.csv');
    expect(uploadRes.status).toBe(200);
    expect(uploadRes.body.jobId).toBeTruthy();
    expect(uploadRes.body.count).toBe(1);

    // Poll the background job (see src/lib/uploadJobs.js) until it's done — same
    // flow the real frontend uses, not a shortcut around it.
    let status;
    for (let i = 0; i < 20; i++) {
      const statusRes = await request(app).get('/api/upload-status/' + uploadRes.body.jobId).set('Cookie', cookie);
      status = statusRes.body.status;
      if (status !== 'processing') break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(status).toBe('done');

    const sale = await prisma.sale.findFirst({ where: { organizationId: org.id, customerNumber: 'TEST-C1' } });
    expect(sale).toBeTruthy();
    expect(sale.revenue).toBe(150);
  });
});
