require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

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

const app = express();

// CSP disabled: the login/signup pages use inline <script> tags. Tighten this
// (nonce-based CSP) before hosting on a public domain.
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

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

app.use(express.static(path.join(__dirname, '..', 'public')));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`רדאר מכירות (SaaS) listening on http://localhost:${PORT}`);
});
