const { Prisma } = require('@prisma/client');
const { isPostgres } = require('./dbProvider');

// Shared by any route whose list columns include joined/display-only fields or
// non-string types (numbers, dates) that Prisma's simple `contains` string filter
// can't handle safely. Only server-defined SQL fragments (col.sql) ever reach
// Prisma.raw; every user-supplied filter value is passed as a normal template
// value, which Prisma.sql parameterizes safely.
function monthExprFor(colSql) {
  return isPostgres()
    ? Prisma.raw(`EXTRACT(MONTH FROM ${colSql})::int`)
    : Prisma.raw(`CAST(strftime('%m', ${colSql}) AS INTEGER)`);
}

// columns: { key: { sql: '<alias>."<field>"', type: 'text' | 'number' | 'year' | 'month' } }
function buildFilterClauses(columns, filters) {
  const clauses = [];
  Object.keys(filters || {}).forEach((key) => {
    const col = columns[key];
    const value = String(filters[key] == null ? '' : filters[key]).trim();
    if (!col || !value) return;
    if (col.type === 'text') {
      clauses.push(Prisma.sql`LOWER(COALESCE(${Prisma.raw(col.sql)}, '')) LIKE LOWER(${'%' + value + '%'})`);
    } else if (col.type === 'number') {
      clauses.push(Prisma.sql`CAST(${Prisma.raw(col.sql)} AS TEXT) LIKE ${'%' + value + '%'}`);
    } else if (col.type === 'year') {
      const y = parseInt(value, 10);
      if (!isNaN(y)) clauses.push(Prisma.sql`${Prisma.raw(col.sql)} >= ${new Date(y, 0, 1)} AND ${Prisma.raw(col.sql)} < ${new Date(y + 1, 0, 1)}`);
    } else if (col.type === 'month') {
      const m = parseInt(value, 10);
      if (!isNaN(m) && m >= 1 && m <= 12) clauses.push(Prisma.sql`${monthExprFor(col.sql)} = ${m}`);
    }
  });
  return clauses;
}

function parseRawListQuery(req, columns, defaultSortKey) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(500, Math.max(1, parseInt(req.query.pageSize, 10) || 50));
  let filters = {};
  if (req.query.filters) {
    try { filters = JSON.parse(req.query.filters); } catch (err) { filters = {}; }
  }
  const sortBy = columns[req.query.sortBy] ? req.query.sortBy : defaultSortKey;
  const sortDir = req.query.sortDir === 'asc' ? 'ASC' : 'DESC';
  return { page, pageSize, filters, sortBy, sortDir };
}

module.exports = { buildFilterClauses, monthExprFor, parseRawListQuery };
