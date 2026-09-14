const prisma = require('../lib/prisma');

// Same not-in-the-JWT reasoning as attachSuperAdmin — a fresh DB lookup so a
// newly-granted super-admin doesn't have to re-log-in for this to take effect.
async function requireSuperAdmin(req, res, next) {
  const user = await prisma.user.findUnique({ where: { id: req.user.userId }, select: { isSuperAdmin: true } });
  if (!user || !user.isSuperAdmin) return res.status(403).json({ error: 'פעולה זו מוגבלת למנהלי-על' });
  next();
}

module.exports = requireSuperAdmin;
