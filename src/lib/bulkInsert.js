// Postgres caps a single query at 65535 bound parameters. A plain createMany() with
// hundreds of thousands of rows (as expected here) would blow past that and fail
// outright, so full-replace uploads chunk the insert into batches instead.
const CHUNK_SIZE = 5000;

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Runs deleteMany + chunked createMany calls as one atomic transaction. Callers now
// always run this from a background job (see lib/uploadJobs.js) rather than inline in
// an HTTP request, so a generous timeout costs nothing — it no longer risks the
// request itself timing out at the platform/proxy level for a very large file.
async function replaceAll(prisma, model, where, rows) {
  const chunks = chunk(rows, CHUNK_SIZE);
  await prisma.$transaction(
    [prisma[model].deleteMany({ where }), ...chunks.map((c) => prisma[model].createMany({ data: c }))],
    { timeout: 600000 }
  );
}

module.exports = { replaceAll, chunk };
