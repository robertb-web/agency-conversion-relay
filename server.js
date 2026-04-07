require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');

const webhookRouter = require('./routes/webhook');
const shopifyWebhookRouter = require('./routes/shopify-webhook');
const dashboardRouter = require('./routes/dashboard');
const authRouter = require('./routes/auth');
const { initDatabase } = require('./db/database');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize database on startup
initDatabase();

// Request logger
app.use((req, res, next) => {
  console.log(`[${req.method}] ${req.url}`);
  next();
});

// Middleware
app.use(express.json({ limit: '10mb', verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false, // set to true if using HTTPS directly (Railway handles HTTPS)
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// Auth middleware for protected routes
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  res.redirect('/login.html');
}

// Public routes
app.use('/auth', authRouter);

// Webhook endpoints (public - GHL/Shopify don't send auth headers by default)
app.use('/webhook', webhookRouter);
app.use('/webhook/shopify', shopifyWebhookRouter);

// Protected dashboard API
app.use('/api', requireAuth, dashboardRouter);

// Serve static files for the dashboard
app.use(express.static(path.join(__dirname, 'public')));

// Root redirect
app.get('/', (req, res) => {
  if (req.session && req.session.authenticated) {
    res.redirect('/index.html');
  } else {
    res.redirect('/login.html');
  }
});

// Health check (for Railway)
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Conversion Relay Server running on port ${PORT}`);
});

module.exports = app;
