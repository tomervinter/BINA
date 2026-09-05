// Parses page/pageSize/sort/filter query params for a list endpoint into a Prisma-ready
// shape. Needed once real data volumes (hundreds of thousands of rows) rule out shipping
// the whole table to the browser and filtering/sorting it client-side.
function parseListQuery(req, { sortableFields, filterableFields, defaultSort }) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  // pageSize=all bypasses pagination entirely — only meant for small reference lists
  // (e.g. populating a customer/product picker), never for transaction-scale tables.
  const wantsAll = req.query.pageSize === 'all';
  const pageSize = wantsAll ? null : Math.min(500, Math.max(1, parseInt(req.query.pageSize, 10) || 50));

  let sortBy = defaultSort.field;
  let sortDir = defaultSort.dir;
  if (sortableFields.includes(req.query.sortBy)) {
    sortBy = req.query.sortBy;
    sortDir = req.query.sortDir === 'asc' ? 'asc' : 'desc';
  }

  let filters = {};
  if (req.query.filters) {
    try { filters = JSON.parse(req.query.filters); } catch (err) { filters = {}; }
  }
  const where = {};
  Object.keys(filters).forEach((key) => {
    if (!filterableFields.includes(key)) return;
    const value = String(filters[key] == null ? '' : filters[key]).trim();
    if (!value) return;
    where[key] = { contains: value, mode: 'insensitive' };
  });

  return {
    page, pageSize, sortBy, sortDir, where,
    skip: wantsAll ? undefined : (page - 1) * pageSize,
    take: wantsAll ? undefined : pageSize
  };
}

module.exports = { parseListQuery };
