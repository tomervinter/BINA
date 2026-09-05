// Postgres caps a single query at 65535 bound parameters. A plain createMany() with
// hundreds of thousands of rows (as expected here) would blow past that and fail
// outright, so full-replace uploads chunk the insert into batches instead.
const CHUNK_SIZE = 5000;

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Runs deleteMany + chunked createMany calls as one atomic transaction, with a
// generous timeout since a very large replace can take a while.
async function replaceAll(prisma, model, where, rows) {
  const chunks = chunk(rows, CHUNK_SIZE);
  await prisma.$transaction(
    [prisma[model].deleteMany({ where }), ...chunks.map((c) => prisma[model].createMany({ data: c }))],
    { timeout: 120000 }
  );
}

module.exports = { replaceAll, chunk };
