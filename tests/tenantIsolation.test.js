// The most security-critical test in this suite: confirms one organization's
// data is never visible to another, across every entity list endpoint.
const request = require('supertest');
const app = require('../src/server');
const prisma = require('../src/lib/prisma');
const { createOrgAndUser, loginAndGetCookie, cleanupOrg } = require('./helpers');

describe('multi-tenant isolation', () => {
  let orgA, userA, cookieA;
  let orgB, userB, cookieB;

  beforeAll(async () => {
    ({ organization: orgA, user: userA } = await createOrgAndUser({
      orgName: 'Tenant A', email: 'tenant-a@example.com', password: 'tenant-a-pass-1234'
    }));
    ({ organization: orgB, user: userB } = await createOrgAndUser({
      orgName: 'Tenant B', email: 'tenant-b@example.com', password: 'tenant-b-pass-1234'
    }));

    await prisma.customer.create({ data: { organizationId: orgA.id, customerNumber: 'A-CUST-1', name: 'Only Org A' } });
    await prisma.product.create({ data: { organizationId: orgA.id, itemCode: 'A-PROD-1', name: 'Only Org A Product' } });
    await prisma.sale.create({ data: { organizationId: orgA.id, customerNumber: 'A-CUST-1', productCode: 'A-PROD-1', date: new Date(2026, 0, 1), quantity: 1, revenue: 100 } });

    await prisma.customer.create({ data: { organizationId: orgB.id, customerNumber: 'B-CUST-1', name: 'Only Org B' } });
    await prisma.product.create({ data: { organizationId: orgB.id, itemCode: 'B-PROD-1', name: 'Only Org B Product' } });
    await prisma.sale.create({ data: { organizationId: orgB.id, customerNumber: 'B-CUST-1', productCode: 'B-PROD-1', date: new Date(2026, 0, 1), quantity: 1, revenue: 200 } });

    cookieA = await loginAndGetCookie(app, userA.email, 'tenant-a-pass-1234');
    cookieB = await loginAndGetCookie(app, userB.email, 'tenant-b-pass-1234');
  });

  afterAll(async () => {
    await cleanupOrg(orgA.id);
    await cleanupOrg(orgB.id);
    await prisma.$disconnect();
  });

  test('org A never sees org B customers/products/sales', async () => {
    const [customers, products, sales] = await Promise.all([
      request(app).get('/api/customers').set('Cookie', cookieA),
      request(app).get('/api/products').set('Cookie', cookieA),
      request(app).get('/api/sales').set('Cookie', cookieA)
    ]);
    expect(customers.body.rows.some((r) => r.customerNumber === 'B-CUST-1')).toBe(false);
    expect(products.body.rows.some((r) => r.itemCode === 'B-PROD-1')).toBe(false);
    expect(sales.body.rows.some((r) => r.customerNumber === 'B-CUST-1')).toBe(false);
    expect(customers.body.rows.some((r) => r.customerNumber === 'A-CUST-1')).toBe(true);
  });

  test('org B never sees org A customers/products/sales', async () => {
    const [customers, products, sales] = await Promise.all([
      request(app).get('/api/customers').set('Cookie', cookieB),
      request(app).get('/api/products').set('Cookie', cookieB),
      request(app).get('/api/sales').set('Cookie', cookieB)
    ]);
    expect(customers.body.rows.some((r) => r.customerNumber === 'A-CUST-1')).toBe(false);
    expect(products.body.rows.some((r) => r.itemCode === 'A-PROD-1')).toBe(false);
    expect(sales.body.rows.some((r) => r.customerNumber === 'A-CUST-1')).toBe(false);
    expect(customers.body.rows.some((r) => r.customerNumber === 'B-CUST-1')).toBe(true);
  });

  test('org A cannot see org B audit log entries', async () => {
    const res = await request(app).get('/api/audit-log').set('Cookie', cookieA);
    expect(res.status).toBe(200);
    expect(res.body.rows.every((r) => r.organizationId === orgA.id)).toBe(true);
  });
});
