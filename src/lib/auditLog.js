const prisma = require('./prisma');

// Records sensitive/destructive actions (see prisma/schema.prisma's AuditLog model
// comment for exactly which ones) — never the routine GET traffic. Failure to write
// the log entry must never break the request that triggered it, so this always
// swallows its own errors.
//
// `actor` is either req.user (the JWT payload shape: {userId, organizationId,
// email}) for routes behind requireAuth, or a plain {organizationId, userId,
// email} object built by hand for the one pre-auth case (login) where req.user
// doesn't exist yet but the target user (and so their org) is already known.
async function logAction(actor, action, details) {
  try {
    await prisma.auditLog.create({
      data: {
        organizationId: actor.organizationId,
        userId: actor.userId || null,
        userEmail: actor.email || null,
        action,
        details: details == null ? null : String(details)
      }
    });
  } catch (err) {
    console.error('Failed to write audit log entry:', action, err);
  }
}

module.exports = { logAction };
