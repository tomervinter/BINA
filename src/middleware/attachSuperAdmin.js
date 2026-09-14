const prisma = require('../lib/prisma');

// isSuperAdmin isn't embedded in the signed JWT (unlike organizationId/role), so a
// freshly-granted super-admin doesn't need to log out and back in for it to take
// effect on their very next request — this always reflects the current DB row.
async function attachSuperAdmin(req, res, next) {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.user.userId }, select: { isSuperAdmin: true } });
    req.isSuperAdmin = !!(user && user.isSuperAdmin);
  } catch (err) {
    req.isSuperAdmin = false;
  }
  next();
}

module.exports = attachSuperAdmin;
