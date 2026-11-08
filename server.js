const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const path = require('path');
const store = require('./store');

const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_DAYS = 7;

const DEFAULTS = {
  title: 'Museum of Us',
  subtitle: 'Every picture tells our story. Walk slowly.',
  question: 'Will you be mine forever?',
  choices: ['Yes, forever ♥', 'Yes!', 'Give me a little time'],
  thanks: 'Your answer has been delivered. Thank you for walking through our story.',
  partnerName: '',
  partnerGender: 'auto',
  contact: '',
};

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));

/* ---------- helpers ---------- */
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const safeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${mac}`;
}
function verify(token) {
  if (!token || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const good = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (!safeEq(mac, good)) return null;
  try { const p = JSON.parse(Buffer.from(body, 'base64url').toString()); return p.exp > Date.now() ? p : null; } catch (e) { return null; }
}
function cookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((c) => { const i = c.indexOf('='); if (i > 0) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim()); });
  return out;
}
const isAdmin = (req) => !!verify(cookies(req).mou_admin);
function requireAdmin(req, res, next) { if (isAdmin(req)) return next(); res.status(401).json({ error: 'Please log in as admin.' }); }
const wrap = (fn) => (req, res) => fn(req, res).catch((err) => { console.error(err); res.status(500).json({ error: 'Something went wrong on the server. Try again.' }); });
const publicExhibit = (e) => ({ id: e.id, url: e.url, title: e.title, description: e.description, w: e.w, h: e.h });
async function settings() { return { ...DEFAULTS, ...(await store.getSettings()) }; }

// simple login rate limit: 10 attempts per 15 min per IP
const attempts = new Map();
function tooMany(ip) {
  const now = Date.now(), win = 15 * 60 * 1000;
  const list = (attempts.get(ip) || []).filter((t) => now - t < win);
  attempts.set(ip, list);
  return list.length >= 10;
}

/* ---------- public API ---------- */
app.get('/api/museum', wrap(async (req, res) => {
  const [s, ex] = await Promise.all([settings(), store.listExhibits()]);
  const { contact, ...pub } = s; // contact only shown after answering
  res.json({ settings: pub, exhibits: ex.map(publicExhibit) });
}));

app.post('/api/visitors', wrap(async (req, res) => {
  const name = str(req.body.name, 40);
  const gender = req.body.gender === 'male' ? 'male' : req.body.gender === 'female' ? 'female' : '';
  const ageN = parseInt(req.body.age, 10);
  const age = ageN > 0 && ageN < 121 ? ageN : null;
  if (!name || !gender) return res.status(400).json({ error: 'Name and gender are required.' });
  // returning visitor on the same device keeps their record
  const prev = req.body.id && req.body.token ? await store.getVisitor(String(req.body.id)) : null;
  if (prev && safeEq(prev.token, req.body.token)) {
    const v = { ...prev, name, gender, age, visits: (prev.visits || 1) + 1 };
    await store.saveVisitor(v);
    return res.json({ id: v.id, token: v.token, answer: v.answer || null });
  }
  const v = { id: crypto.randomUUID(), token: crypto.randomBytes(18).toString('base64url'), name, gender, age, answer: null, answeredAt: null, visits: 1, createdAt: new Date().toISOString() };
  await store.saveVisitor(v);
  res.json({ id: v.id, token: v.token, answer: null });
}));

app.post('/api/visitors/:id/answer', wrap(async (req, res) => {
  const v = await store.getVisitor(req.params.id);
  if (!v || !safeEq(v.token, req.body.token || '')) return res.status(404).json({ error: 'Visitor not found. Enter the museum again.' });
  const s = await settings();
  const answer = str(req.body.answer, 80);
  if (!s.choices.includes(answer)) return res.status(400).json({ error: 'That answer isn\'t one of the choices.' });
  await store.saveVisitor({ ...v, answer, answeredAt: new Date().toISOString() });
  res.json({ ok: true, contact: s.contact || '' });
}));

/* ---------- admin API ---------- */
app.post('/api/admin/login', (req, res) => {
  if (tooMany(req.ip)) return res.status(429).json({ error: 'Too many attempts. Wait 15 minutes and try again.' });
  const okUser = safeEq(str(req.body.username, 100), ADMIN_USER);
  const okPass = safeEq(typeof req.body.password === 'string' ? req.body.password : '', ADMIN_PASSWORD);
  if (!(okUser && okPass)) { attempts.get(req.ip).push(Date.now()); return res.status(401).json({ error: 'Wrong username or password.' }); }
  const token = sign({ u: ADMIN_USER, exp: Date.now() + SESSION_DAYS * 864e5 });
  res.setHeader('Set-Cookie', `mou_admin=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${req.secure ? '; Secure' : ''}`);
  res.json({ ok: true });
});
app.post('/api/admin/logout', (req, res) => { res.setHeader('Set-Cookie', 'mou_admin=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'); res.json({ ok: true }); });
app.get('/api/admin/me', (req, res) => res.json({ admin: isAdmin(req) }));

app.get('/api/admin/settings', requireAdmin, wrap(async (req, res) => res.json(await settings())));
app.put('/api/admin/settings', requireAdmin, wrap(async (req, res) => {
  const b = req.body || {};
  const choices = Array.isArray(b.choices) ? b.choices.map((c) => str(c, 80)).filter(Boolean).slice(0, 6) : [];
  const data = {
    title: str(b.title, 60) || DEFAULTS.title,
    subtitle: str(b.subtitle, 120),
    question: str(b.question, 120) || DEFAULTS.question,
    choices: choices.length ? choices : DEFAULTS.choices,
    thanks: str(b.thanks, 300),
    partnerName: str(b.partnerName, 40),
    partnerGender: ['male', 'female'].includes(b.partnerGender) ? b.partnerGender : 'auto',
    contact: str(b.contact, 80),
  };
  await store.saveSettings(data);
  res.json(data);
}));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1 } });
const TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
function sniff(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buf.slice(0, 3).toString() === 'GIF') return 'image/gif';
  return null;
}
app.post('/api/admin/exhibits', requireAdmin, (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'That picture is larger than 15 MB.' : 'Upload failed. Try again.' });
    wrap(async () => {
      if (!req.file) return res.status(400).json({ error: 'Choose a picture to upload.' });
      const type = sniff(req.file.buffer);
      if (!type) return res.status(400).json({ error: 'Only JPG, PNG, WebP and GIF pictures are supported.' });
      const w = Math.max(1, parseInt(req.body.w, 10) || 800), h = Math.max(1, parseInt(req.body.h, 10) || 1000);
      const e = await store.addExhibit({ buffer: req.file.buffer, contentType: type, ext: TYPES[type], title: str(req.body.title, 60) || 'Untitled', w, h });
      res.json(publicExhibit(e));
    })(req, res);
  });
});
app.patch('/api/admin/exhibits/:id', requireAdmin, wrap(async (req, res) => {
  await store.updateExhibit(req.params.id, { title: req.body.title !== undefined ? str(req.body.title, 60) : undefined, description: req.body.description !== undefined ? str(req.body.description, 600) : undefined });
  res.json({ ok: true });
}));
app.post('/api/admin/exhibits/order', requireAdmin, wrap(async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(String) : [];
  const base = Date.now();
  for (let i = 0; i < ids.length; i++) await store.updateExhibit(ids[i], { sort: base + i });
  res.json({ ok: true });
}));
app.delete('/api/admin/exhibits/:id', requireAdmin, wrap(async (req, res) => { await store.deleteExhibit(req.params.id); res.json({ ok: true }); }));
app.get('/api/admin/visitors', requireAdmin, wrap(async (req, res) => {
  res.json((await store.listVisitors()).map(({ token, ...v }) => v));
}));
app.delete('/api/admin/visitors/:id', requireAdmin, wrap(async (req, res) => { await store.deleteVisitor(req.params.id); res.json({ ok: true }); }));

/* ---------- static ---------- */
if (store.serveUploads) app.use('/uploads', express.static(store.serveUploads, { maxAge: '7d' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('/healthz', (req, res) => res.send('ok'));

app.listen(PORT, () => {
  console.log(`Museum running on http://localhost:${PORT} (storage: ${store.kind})`);
  if (!process.env.SESSION_SECRET) console.log('Tip: set SESSION_SECRET so admin logins survive restarts.');
});
