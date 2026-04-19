// server/index.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const session = require('express-session');
const bodyParser = require('body-parser');
const speakeasy = require('speakeasy');
const fetch = global.fetch || require('node-fetch');

const requiredEnv = ['ADMIN_USER','ADMIN_PASS','ADMIN_PATH','NOTES_PATH','SESSION_SECRET','PORT'];
const missing = requiredEnv.filter(k => !process.env[k]);
if (missing.length) {
  console.error('Missing required environment variables:', missing.join(', '));
  process.exit(1);
}

const AUTH_MODE = (process.env.AUTH_MODE || 'none').toLowerCase();
if (AUTH_MODE === 'hcaptcha' && !process.env.HCAPTCHA_SECRET) {
  console.error('AUTH_MODE=hcaptcha requires HCAPTCHA_SECRET env var.');
  process.exit(1);
}
if (AUTH_MODE === 'cf' && !process.env.CF_TURNSTILE_SECRET) {
  console.error('AUTH_MODE=cf requires CF_TURNSTILE_SECRET env var.');
  process.exit(1);
}
if (AUTH_MODE === 'f2a' && !process.env.F2A_SECRET) {
  console.error('AUTH_MODE=f2a requires F2A_SECRET env var.');
  process.exit(1);
}

const PORT = parseInt(process.env.PORT, 10);
const MAX_MB = parseInt(process.env.MAX_UPLOAD_MB || '2', 10);
const publicDir = path.join(__dirname, '..', 'public');
const uploadDir = path.join(publicDir, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // production: set true behind TLS
}));

// Multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const safe = Date.now() + '-' + file.originalname.replace(/\s+/g, '_');
    cb(null, safe);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/\.html?$/.test(file.originalname.toLowerCase())) cb(null, true);
    else cb(new Error('Only HTML files allowed'));
  }
});

// Helper: is API
function isApiRequest(req) {
  return req.path.startsWith('/api/');
}

// Auth middleware
function requireAuth(req, res, next) {
  if (req.session && req.session.authed) return next();
  if (isApiRequest(req)) return res.status(401).json({ error: 'Unauthorized' });
  return res.redirect('/login');
}

// Serve assets publicly
app.use('/assets', express.static(path.join(publicDir, 'assets')));

// Serve login page at /login (public)
app.get('/login', (req, res) => {
  res.sendFile(path.join(publicDir, 'login.html'));
});

// API: login (public)
async function verifyHcaptcha(token) {
  const secret = process.env.HCAPTCHA_SECRET;
  if (!secret) return false;
  try {
    const resp = await fetch('https://hcaptcha.com/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `secret=${encodeURIComponent(secret)}&response=${encodeURIComponent(token)}`
    });
    const j = await resp.json();
    return !!j.success;
  } catch (e) { console.error(e); return false; }
}
async function verifyTurnstile(token) {
  const secret = process.env.CF_TURNSTILE_SECRET;
  if (!secret) return false;
  try {
    const resp = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `secret=${encodeURIComponent(secret)}&response=${encodeURIComponent(token)}`
    });
    const j = await resp.json();
    return !!j.success;
  } catch (e) { console.error(e); return false; }
}

app.post('/api/login', async (req, res) => {
  const { user, pass, token, f2a } = req.body || {};
  if (!user || !pass) return res.status(400).json({ error: 'Missing credentials' });
  if (user !== process.env.ADMIN_USER || pass !== process.env.ADMIN_PASS) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  if (AUTH_MODE === 'hcaptcha') {
    if (!token) return res.status(401).json({ error: 'Missing captcha token' });
    const ok = await verifyHcaptcha(token);
    if (!ok) return res.status(401).json({ error: 'Captcha verification failed' });
  } else if (AUTH_MODE === 'cf') {
    if (!token) return res.status(401).json({ error: 'Missing turnstile token' });
    const ok = await verifyTurnstile(token);
    if (!ok) return res.status(401).json({ error: 'Turnstile verification failed' });
  } else if (AUTH_MODE === 'f2a') {
    if (!f2a) return res.status(401).json({ error: 'Missing 2FA token' });
    const verified = speakeasy.totp.verify({
      secret: process.env.F2A_SECRET,
      encoding: 'base32',
      token: f2a,
      window: 1
    });
    if (!verified) return res.status(401).json({ error: 'Invalid 2FA token' });
  }
  req.session.authed = true;
  res.json({ ok: true, redirect: process.env.ADMIN_PATH || '/admin' });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(()=>res.json({ ok:true }));
});

// Protected config endpoint
app.get('/api/config', requireAuth, (req, res) => {
  res.json({
    site_name: process.env.SITE_NAME || 'MarinaNote',
    notes_path: process.env.NOTES_PATH,
    admin_path: process.env.ADMIN_PATH,
    auth_mode: process.env.AUTH_MODE || 'none',
    hcaptcha_sitekey: process.env.HCAPTCHA_SITEKEY || '',
    cf_sitekey: process.env.CF_TURNSTILE_SITEKEY || ''
  });
});

// Upload (protected)
app.post('/api/upload', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ url: `/uploads/${req.file.filename}` });
});

// Save config (protected)
app.post('/api/save-config', requireAuth, (req, res) => {
  fs.writeFileSync(path.join(uploadDir, 'site-config.json'), JSON.stringify(req.body || {}, null, 2));
  res.json({ ok:true });
});
app.get('/api/site-config', requireAuth, (req, res) => {
  const cfgPath = path.join(uploadDir, 'site-config.json');
  if (fs.existsSync(cfgPath)) return res.json(JSON.parse(fs.readFileSync(cfgPath,'utf8')));
  res.json({});
});

// Notes (protected)
app.post('/api/save-notes', requireAuth, (req, res) => {
  fs.writeFileSync(path.join(uploadDir, 'notes-content.json'), JSON.stringify({ content: req.body.content || '' }, null, 2));
  res.json({ ok:true });
});
app.get('/api/notes-content', requireAuth, (req, res) => {
  const notesFile = path.join(uploadDir, 'notes-content.json');
  if (fs.existsSync(notesFile)) return res.json(JSON.parse(fs.readFileSync(notesFile,'utf8')));
  res.json({ content: '' });
});

// Serve uploads via protected route
app.get('/uploads/:file', requireAuth, (req, res) => {
  const file = req.params.file;
  const filePath = path.join(uploadDir, file);
  if (!filePath.startsWith(uploadDir)) return res.status(400).send('Invalid file');
  if (!fs.existsSync(filePath)) return res.status(404).send('Not found');
  res.sendFile(filePath);
});

// Serve admin and notes pages at /admin and /notes (protected)
app.get('/admin', requireAuth, (req, res) => {
  res.sendFile(path.join(publicDir, 'admin.html'));
});
app.get('/notes', requireAuth, (req, res) => {
  res.sendFile(path.join(publicDir, 'notes.html'));
});

// Root redirect to login or admin if authed
app.get('/', (req, res) => {
  if (req.session && req.session.authed) return res.redirect(process.env.ADMIN_PATH || '/admin');
  return res.redirect('/login');
});

// Security header
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

// Fallback: 404
app.use((req, res) => {
  res.status(404).send('Not found');
});

app.listen(PORT, ()=>console.log(`MarinaNote listening on ${PORT}`));