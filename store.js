// Storage for settings, pictures and visitors.
// Uses Supabase when SUPABASE_URL and SUPABASE_SERVICE_KEY are set,
// otherwise a local JSON file + uploads folder (fine for trying it out,
// but Render's free plan wipes local files on every restart).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BUCKET = process.env.SUPABASE_BUCKET || 'pictures';

function uid() { return crypto.randomUUID(); }

/* ---------------- Supabase ---------------- */
function supabaseStore() {
  const { createClient } = require('@supabase/supabase-js');
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false },
  });
  const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
  const publicUrl = (p) => sb.storage.from(BUCKET).getPublicUrl(p).data.publicUrl;
  const toExhibit = (r) => ({ id: r.id, url: publicUrl(r.image_path), imagePath: r.image_path, title: r.title, description: r.description, sort: r.sort, w: r.w, h: r.h });
  const toVisitor = (r) => ({ id: r.id, token: r.token, name: r.name, gender: r.gender, age: r.age, answer: r.answer, answeredAt: r.answered_at, visits: r.visits, createdAt: r.created_at, updatedAt: r.updated_at });

  return {
    kind: 'supabase',
    async getSettings() {
      const rows = must(await sb.from('settings').select('data').eq('id', 1));
      return rows[0] ? rows[0].data : {};
    },
    async saveSettings(data) { must(await sb.from('settings').upsert({ id: 1, data })); },
    async listExhibits() {
      return must(await sb.from('exhibits').select('*').order('sort', { ascending: true })).map(toExhibit);
    },
    async addExhibit({ buffer, contentType, ext, title, w, h }) {
      const imagePath = `${uid()}.${ext}`;
      must(await sb.storage.from(BUCKET).upload(imagePath, buffer, { contentType, upsert: false }));
      const rows = must(await sb.from('exhibits').insert({ id: uid(), image_path: imagePath, title, description: '', sort: Date.now(), w, h }).select());
      return toExhibit(rows[0]);
    },
    async updateExhibit(id, patch) {
      const p = {};
      if (patch.title !== undefined) p.title = patch.title;
      if (patch.description !== undefined) p.description = patch.description;
      if (patch.sort !== undefined) p.sort = patch.sort;
      must(await sb.from('exhibits').update(p).eq('id', id));
    },
    async deleteExhibit(id) {
      const rows = must(await sb.from('exhibits').select('image_path').eq('id', id));
      must(await sb.from('exhibits').delete().eq('id', id));
      if (rows[0]) await sb.storage.from(BUCKET).remove([rows[0].image_path]);
    },
    async getVisitor(id) {
      const rows = must(await sb.from('visitors').select('*').eq('id', id));
      return rows[0] ? toVisitor(rows[0]) : null;
    },
    async saveVisitor(v) {
      must(await sb.from('visitors').upsert({
        id: v.id, token: v.token, name: v.name, gender: v.gender, age: v.age, answer: v.answer || null,
        answered_at: v.answeredAt || null, visits: v.visits || 1, created_at: v.createdAt, updated_at: new Date().toISOString(),
      }));
    },
    async listVisitors() {
      return must(await sb.from('visitors').select('*').order('updated_at', { ascending: false })).map(toVisitor);
    },
    async deleteVisitor(id) { must(await sb.from('visitors').delete().eq('id', id)); },
    serveUploads: null,
  };
}

/* ---------------- Local files ---------------- */
function localStore() {
  const dir = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
  const upl = path.join(dir, 'uploads');
  fs.mkdirSync(upl, { recursive: true });
  const file = path.join(dir, 'db.json');
  let db = { settings: {}, exhibits: [], visitors: [] };
  try { db = { ...db, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch (e) { /* fresh start */ }
  const save = () => { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(db, null, 1)); fs.renameSync(tmp, file); };
  const toExhibit = (r) => ({ ...r, url: '/uploads/' + r.imagePath });

  return {
    kind: 'local',
    async getSettings() { return db.settings || {}; },
    async saveSettings(data) { db.settings = data; save(); },
    async listExhibits() { return [...db.exhibits].sort((a, b) => a.sort - b.sort).map(toExhibit); },
    async addExhibit({ buffer, ext, title, w, h }) {
      const imagePath = `${uid()}.${ext}`;
      fs.writeFileSync(path.join(upl, imagePath), buffer);
      const r = { id: uid(), imagePath, title, description: '', sort: Date.now(), w, h };
      db.exhibits.push(r); save();
      return toExhibit(r);
    },
    async updateExhibit(id, patch) {
      const r = db.exhibits.find((x) => x.id === id); if (!r) return;
      for (const k of ['title', 'description', 'sort']) if (patch[k] !== undefined) r[k] = patch[k];
      save();
    },
    async deleteExhibit(id) {
      const r = db.exhibits.find((x) => x.id === id);
      db.exhibits = db.exhibits.filter((x) => x.id !== id); save();
      if (r) fs.rm(path.join(upl, r.imagePath), { force: true }, () => {});
    },
    async getVisitor(id) { return db.visitors.find((v) => v.id === id) || null; },
    async saveVisitor(v) {
      const i = db.visitors.findIndex((x) => x.id === v.id);
      const row = { ...v, updatedAt: new Date().toISOString() };
      if (i >= 0) db.visitors[i] = row; else db.visitors.push(row);
      save();
    },
    async listVisitors() { return [...db.visitors].sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')); },
    async deleteVisitor(id) { db.visitors = db.visitors.filter((v) => v.id !== id); save(); },
    serveUploads: upl,
  };
}

module.exports = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) ? supabaseStore() : localStore();
