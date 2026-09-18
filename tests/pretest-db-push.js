// Syncs the test SQLite database's schema before the suite runs — a plain npm
// script (rather than a bash/cmd one-liner) so it works identically on any OS,
// since it sets DATABASE_URL via child_process's `env` option instead of shell
// syntax that differs between bash and cmd.exe.
const { execSync } = require('child_process');
const path = require('path');

execSync('npx prisma db push --skip-generate --accept-data-loss', {
  cwd: path.join(__dirname, '..'),
  stdio: 'inherit',
  env: Object.assign({}, process.env, { DATABASE_URL: 'file:./test.db' })
});
