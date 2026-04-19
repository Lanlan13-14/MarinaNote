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
  console.error('MarinaNote will exit. Provide these env vars at container runtime.');
  process.exit(1);
}

// If AUTH_MODE requires secrets, ensure they exist
const authMode = (process.env.AUTH_MODE || 'none').toLowerCase();
if (authMode === 'hcaptcha' && !process.env.HCAPTCHA_SECRET) {
  console.error('AUTH_MODE=hcaptcha requires HCAPTCHA_SECRET env var.');
  process.exit(1);
}
if (authMode === 'cf' && !process.env.CF_TURNSTILE_SECRET) {
  console.error('AUTH_MODE=cf requires CF_TURNSTILE_SECRET env var.');
  process.exit(1);
}
if (authMode === 'f2a' && !process.env.F2A_SECRET) {
  console.error('AUTH_MODE=f2a requires F2A_SECRET env var.');
  process.exit(1);
}

const PORT = parseInt(process.env.PORT, 10);
const MAX_MB = parseInt(process.env.MAX_UPLOAD_MB || '2', 10);
const uploadDir = path.join(__dirname, '..', 'public', 'uploads');
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

// Serve static files (login/admin/notes + assets). uploads is mounted from host.
app.use(express.static(path.join(__dirname, '..', 'public')));

// Multer config: only allow .html
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

// Auth middleware
function requireAuth(req, res, next){
  if (req.session && req.session.authed) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

// Helper: verify hCaptcha token
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
  } catch (e) {
    console.error('hCaptcha verify error', e);
    return false;
  }
}

// Helper: verify Cloudflare Turnstile token
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
  } catch (e) {
    console.error('Turnstile verify error', e);
    return false;
  }
}

// Login endpoint
app.post('/api/login', async (req, res) => {
  const { user, pass, token, f2a } = req.body || {};
  if (!user || !pass) return res.status(400).json({ error: 'Missing credentials' });

  if (user !== process.env.ADMIN_USER || pass !== process.env.ADMIN_PASS) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const mode = (process.env.AUTH_MODE || 'none').toLowerCase();

  if (mode === 'hcaptcha') {
    if (!token) return res.status(401).json({ error: 'Missing captcha token' });
    const ok = await verifyHcaptcha(token);
    if (!ok) return res.status(401).json({ error: 'Captcha verification failed' });
  } else if (mode === 'cf') {
    if (!token) return res.status(401).json({ error: 'Missing turnstile token' });
    const ok = await verifyTurnstile(token);
    if (!ok) return res.status(401).json({ error: 'Turnstile verification failed' });
  } else if (mode === 'f2a') {
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
  res.json({ ok: true, redirect: process.env.ADMIN_PATH });
});

// Logout
app.post('/api/logout', (req, res) => {
  req.session.destroy(()=>res.json({ ok:true }));
});

// Public config endpoint (frontend reads)
app.get('/api/config', (req, res) => {
  res.json({
    site_name: process.env.SITE_NAME || 'MarinaNote',
    notes_path: process.env.NOTES_PATH,
    admin_path: process.env.ADMIN_PATH,
    auth_mode: process.env.AUTH_MODE || 'none',
    hcaptcha_sitekey: process.env.HCAPTCHA_SITEKEY || '',
    cf_sitekey: process.env.CF_TURNSTILE_SITEKEY || ''
  });
});

// Upload HTML (protected)
app.post('/api/upload', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const url = `/uploads/${req.file.filename}`;
  res.json({ url });
});

// Save site config (protected)
app.post('/api/save-config', requireAuth, (req, res) => {
  const cfgPath = path.join(uploadDir, 'site-config.json');
  fs.writeFileSync(cfgPath, JSON.stringify(req.body || {}, null, 2));
  res.json({ ok:true });
});

// Read saved site config
app.get('/api/site-config', (req, res) => {
  const cfgPath = path.join(uploadDir, 'site-config.json');
  if (fs.existsSync(cfgPath)) {
    return res.json(JSON.parse(fs.readFileSync(cfgPath,'utf8')));
  }
  res.json({});
});

// Save notes (protected)
app.post('/api/save-notes', requireAuth, (req, res) => {
  const notesFile = path.join(uploadDir, 'notes-content.json');
  fs.writeFileSync(notesFile, JSON.stringify({ content: req.body.content || '' }, null, 2));
  res.json({ ok:true });
});

// Read notes (public)
app.get('/api/notes-content', (req, res) => {
  const notesFile = path.join(uploadDir, 'notes-content.json');
  if (fs.existsSync(notesFile)) {
    return res.json(JSON.parse(fs.readFileSync(notesFile,'utf8')));
  }
  res.json({ content: '' });
});

// Security header
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

app.listen(PORT, ()=>console.log(`MarinaNote listening on ${PORT}`));