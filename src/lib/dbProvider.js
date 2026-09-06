// The app runs on SQLite locally and PostgreSQL in production (see prisma/schema.prisma's
// datasource, toggled manually between the two). Raw SQL needed for the full sales report's
// cross-table sort/filter has to special-case a couple of engine-specific expressions.
function isPostgres() {
  const url = process.env.DATABASE_URL || '';
  return url.startsWith('postgres://') || url.startsWith('postgresql://');
}

module.exports = { isPostgres };
