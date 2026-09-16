const multer = require('multer');

// 50MB comfortably covers a several-hundred-thousand-row CSV/xlsx while still
// bounding the in-memory buffer multer holds per upload (memoryStorage keeps the
// whole file in RAM) — an unbounded size accepted any file, of any size, into
// server memory.
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const ALLOWED_EXTENSIONS = ['csv', 'xlsx', 'xls'];

function fileFilter(req, file, cb) {
  const ext = String(file.originalname || '').toLowerCase().split('.').pop();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return cb(new Error('סוג קובץ לא נתמך — יש להעלות קובץ CSV, XLSX או XLS בלבד'));
  }
  cb(null, true);
}

// Shared by every '/upload' route (sales/customers/products/inventory) instead
// of each defining its own unbounded multer({ storage: memoryStorage() }).
module.exports = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter
});
