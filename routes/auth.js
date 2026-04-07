const express = require('express');
const router = express.Router();

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';

/**
 * POST /auth/login
 * Authenticates the dashboard user.
 */
router.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    req.session.authenticated = true;
    req.session.username = username;
    return res.json({ success: true });
  }

  return res.status(401).json({ success: false, error: 'Invalid username or password' });
});

/**
 * POST /auth/logout
 */
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

/**
 * GET /auth/me
 * Returns current session status.
 */
router.get('/me', (req, res) => {
  if (req.session && req.session.authenticated) {
    return res.json({ authenticated: true, username: req.session.username });
  }
  return res.status(401).json({ authenticated: false });
});

module.exports = router;
