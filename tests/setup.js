// Runs before any test file is loaded (see package.json's "jest.setupFiles").
// Sets a dedicated SQLite file for tests — completely separate from dev.db —
// before src/lib/prisma.js (or dotenv) ever gets a chance to read DATABASE_URL.
// dotenv.config() (called at the top of src/server.js) never overrides an
// already-set env var, so setting these here first is what makes it stick.
process.env.DATABASE_URL = 'file:./test.db';
process.env.JWT_SECRET = 'test-jwt-secret-not-for-production';
process.env.NODE_ENV = 'test';
