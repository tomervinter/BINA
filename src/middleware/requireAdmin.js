function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'פעולה זו מוגבלת למנהלי חברה' });
  next();
}

module.exports = requireAdmin;
