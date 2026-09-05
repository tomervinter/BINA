const prisma = require('./prisma');

// Manual-only classification: no auto-detection or category-based suggestions.
// A cell is either explicitly set by a person (manual) or unclassified — unclassified
// cells are what drive the "needs attention" row highlight in the UI.
async function loadContext(organizationId) {
  const [holidays, seasons, products, overrides] = await Promise.all([
    prisma.holiday.findMany({ where: { organizationId } }),
    prisma.season.findMany({ where: { organizationId } }),
    prisma.product.findMany({ where: { organizationId } }),
    prisma.relevanceOverride.findMany({ where: { organizationId } })
  ]);
  const overrideMap = {};
  overrides.forEach((o) => { overrideMap[o.productCode + '|' + o.source + '|' + o.name] = o.value; });
  return { overrideMap, holidays, seasons, products };
}

function directState(ctx, pid, source, name) {
  const key = pid + '|' + source + '|' + name;
  if (Object.prototype.hasOwnProperty.call(ctx.overrideMap, key)) return { value: !!ctx.overrideMap[key], manual: true, known: true };
  return null;
}

function isRelevant(ctx, pid, source, name) {
  return directState(ctx, pid, source, name) || { value: false, manual: false, known: false };
}

function getCellState(ctx, pid, source, name) {
  return directState(ctx, pid, source, name) || { value: false, manual: false, known: false };
}

module.exports = { loadContext, isRelevant, getCellState };
