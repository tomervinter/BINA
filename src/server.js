require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');

const authRoutes = require('./routes/auth');
const customerRoutes = require('./routes/customers');
const productRoutes = require('./routes/products');
const salesRoutes = require('./routes/sales');
const insightsRoutes = require('./routes/insights');
const ruleSettingsRoutes = require('./routes/ruleSettings');
const usersRoutes = require('./routes/users');
const inventoryRoutes = require('./routes/inventory');
const holidaysRoutes = require('./routes/holidays');
const seasonsRoutes = require('./routes/seasons');
const relevanceRoutes = require('./routes/relevance');
const navCountsRoutes = require('./routes/navCounts');
const templatesRoutes = require('./routes/templates');
const dashboardYoyRoutes = require('./routes/dashboardYoy');
const productSubstitutesRoutes = require('./routes/productSubstitutes');
const salesFullReportRoutes = require('./routes/salesFullReport');
const dashboardSalesSummaryRoutes = require('./routes/dashboardSalesSummary');
const columnOrderRoutes = require('./routes/columnOrder');
const organizationsRoutes = require('./routes/organizations');
const uploadStatusRoutes = require('./routes/uploadStatus');
const auditLogRoutes = require('./routes/auditLog');

const app = express();

// Render sits exactly one reverse-proxy hop in front of this app, and sets
// X-Forwarded-For on every request. Without this, express-rate-limit refuses to
// trust that header (correctly, by default — trusting a spoofable header without
// being told to is unsafe) and throws on every rate-limited request, which was
// crash-looping the whole process in production the moment it received real
// traffic and never happened locally (no proxy in front of it there).
app.set('trust proxy', 1);

// Every page script now lives in an external public/js/*.js file (no inline
// <script> blocks anywhere in public/*.html), so script-src can drop
// 'unsafe-inline' entirely — only same-origin scripts and the Chart.js UMD
// build (dashboard.html, reports-yoy.html) are allowed to run. style-src keeps
// 'unsafe-inline' since the UI relies heavily on inline style="" attributes;
// that's a much smaller blast radius than allowing arbitrary inline script.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://cdnjs.cloudflare.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      imgSrc: ["'self'", 'data:'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'self'"]
    }
  }
}));
app.use(compression());
app.use(cors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// General ceiling on every API route (previously only /api/auth was limited at
// all) — generous enough not to interfere with a dashboard page's normal burst
// of AJAX calls, but bounds abuse/scripted hammering of any endpoint. The
// stricter authLimiter below still applies on top of this for login specifically.
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 600, standardHeaders: true, legacyHeaders: false });
app.use('/api', apiLimiter);

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/products', productRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/insights', insightsRoutes);
app.use('/api/rule-settings', ruleSettingsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/holidays', holidaysRoutes);
app.use('/api/seasons', seasonsRoutes);
app.use('/api/relevance', relevanceRoutes);
app.use('/api/nav-counts', navCountsRoutes);
app.use('/api/templates', templatesRoutes);
app.use('/api/dashboard-yoy', dashboardYoyRoutes);
app.use('/api/product-substitutes', productSubstitutesRoutes);
app.use('/api/sales-full-report', salesFullReportRoutes);
app.use('/api/dashboard-sales-summary', dashboardSalesSummaryRoutes);
app.use('/api/column-order', columnOrderRoutes);
app.use('/api/organizations', organizationsRoutes);
app.use('/api/upload-status', uploadStatusRoutes);
app.use('/api/audit-log', auditLogRoutes);

// A short max-age (not no-cache): every navigation was paying a full network
// round-trip per static JS/CSS file just to revalidate a file that almost never
// changes between requests. A 60s cache still surfaces a fresh deploy within a
// minute, but lets an active browsing session reuse assets from disk instead of
// re-fetching them on every single page.
app.use(express.static(path.join(__dirname, '..', 'public'), {
  setHeaders: (res) => res.setHeader('Cache-Control', 'public, max-age=60')
}));

// Catches any error passed via next(err), or an async route handler's rejected
// promise (Express 5 forwards those here automatically) — including multer's
// file-type/file-size rejections from uploadMiddleware.js — and responds with
// plain JSON instead of Express's default HTML error page, which every
// frontend fetch() call in this app assumes it can res.json() unconditionally.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error('Unhandled request error:', err);
  const status = err.status || err.statusCode || 400;
  res.status(status).json({ error: err.message || 'שגיאה בעיבוד הבקשה' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`BINA (SaaS) listening on http://localhost:${PORT}`);
});
