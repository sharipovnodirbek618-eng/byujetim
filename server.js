require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');

const app = express();
app.use(express.json());

const SECRET = process.env.SECRET || crypto.randomBytes(32).toString('hex');
let pool;

/* ---------- Baza ---------- */
async function initDB() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    port: Number(process.env.DB_PORT) || 3306,
    charset: 'UTF8_GENERAL_CI',
  });
  try {
    await conn.query(`CREATE DATABASE IF NOT EXISTS \`${process.env.DB_NAME}\` CHARACTER SET utf8`);
  } catch (e) {
    console.log('Baza allaqachon mavjud, davom etamiz');
  }
  await conn.end();

  pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    port: Number(process.env.DB_PORT) || 3306,
    database: process.env.DB_NAME,
    charset: 'UTF8_GENERAL_CI',
    dateStrings: true,
    waitForConnections: true,
    connectionLimit: 10,
  });

  await pool.query(`CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS transactions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    type ENUM('income','expense') NOT NULL,
    category VARCHAR(50) NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    note VARCHAR(255),
    date DATE NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS budgets (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    category VARCHAR(50) NOT NULL,
    limit_amount DECIMAL(15,2) NOT NULL,
    month CHAR(7) NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS goals (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    title VARCHAR(100) NOT NULL,
    target_amount DECIMAL(15,2) NOT NULL,
    current_amount DECIMAL(15,2) DEFAULT 0,
    deadline DATE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )`);
  console.log('✅ MySQL ulandi, baza va jadvallar tayyor');
}

/* ---------- Yordamchilar ---------- */
const h = (fn) => (req, res) =>
  fn(req, res).catch((e) => {
    console.error(e);
    res.status(500).json({ error: 'Server xatosi' });
  });

const ds = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const mk = (d) => ds(d).slice(0, 7);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const isMonth = (s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s || '');
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : NaN; };

function sign(payload) {
  const b = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const s = crypto.createHmac('sha256', SECRET).update(b).digest('base64url');
  return b + '.' + s;
}
function verify(token) {
  try {
    const [b, s] = String(token).split('.');
    const exp = crypto.createHmac('sha256', SECRET).update(b).digest('base64url');
    if (s.length !== exp.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(exp))) return null;
    const p = JSON.parse(Buffer.from(b, 'base64url').toString());
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}
function auth(req, res, next) {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  const p = verify(t);
  if (!p) return res.status(401).json({ error: 'Kirish talab qilinadi' });
  req.uid = p.id;
  next();
}
const makeToken = (id) => sign({ id, exp: Date.now() + 30 * 24 * 3600 * 1000 });

/* ---------- Sahifalar ---------- */
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/style.css', (req, res) => res.sendFile(path.join(__dirname, 'style.css')));
app.get('/script.js', (req, res) => res.sendFile(path.join(__dirname, 'script.js')));

/* ---------- Autentifikatsiya ---------- */
app.post('/api/register', h(async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || '').trim().slice(0, 100);
  const email = String(b.email || '').trim().toLowerCase().slice(0, 150);
  const password = String(b.password || '');
  if (name.length < 2) return res.status(400).json({ error: 'Ism kamida 2 ta belgi bo\'lsin' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Email noto\'g\'ri' });
  if (password.length < 6) return res.status(400).json({ error: 'Parol kamida 6 ta belgi bo\'lsin' });
  const [ex] = await pool.query('SELECT id FROM users WHERE email=?', [email]);
  if (ex.length) return res.status(400).json({ error: 'Bu email allaqachon ro\'yxatdan o\'tgan' });
  const hash = await bcrypt.hash(password, 10);
  const [r] = await pool.query('INSERT INTO users (name,email,password_hash) VALUES (?,?,?)', [name, email, hash]);
  res.json({ token: makeToken(r.insertId), user: { id: r.insertId, name, email } });
}));

app.post('/api/login', h(async (req, res) => {
  const b = req.body || {};
  const email = String(b.email || '').trim().toLowerCase();
  const [rows] = await pool.query('SELECT * FROM users WHERE email=?', [email]);
  const u = rows[0];
  if (!u || !(await bcrypt.compare(String(b.password || ''), u.password_hash)))
    return res.status(401).json({ error: 'Email yoki parol noto\'g\'ri' });
  res.json({ token: makeToken(u.id), user: { id: u.id, name: u.name, email: u.email } });
}));

app.get('/api/me', auth, h(async (req, res) => {
  const [rows] = await pool.query('SELECT id,name,email FROM users WHERE id=?', [req.uid]);
  if (!rows[0]) return res.status(401).json({ error: 'Foydalanuvchi topilmadi' });
  res.json(rows[0]);
}));

app.put('/api/me', auth, h(async (req, res) => {
  const name = String((req.body || {}).name || '').trim().slice(0, 100);
  if (name.length < 2) return res.status(400).json({ error: 'Ism kamida 2 ta belgi bo\'lsin' });
  await pool.query('UPDATE users SET name=? WHERE id=?', [name, req.uid]);
  res.json({ ok: true, name });
}));

app.put('/api/password', auth, h(async (req, res) => {
  const b = req.body || {};
  const [rows] = await pool.query('SELECT password_hash FROM users WHERE id=?', [req.uid]);
  if (!rows[0] || !(await bcrypt.compare(String(b.old || ''), rows[0].password_hash)))
    return res.status(400).json({ error: 'Eski parol noto\'g\'ri' });
  if (String(b.new || '').length < 6) return res.status(400).json({ error: 'Yangi parol kamida 6 ta belgi bo\'lsin' });
  await pool.query('UPDATE users SET password_hash=? WHERE id=?', [await bcrypt.hash(String(b.new), 10), req.uid]);
  res.json({ ok: true });
}));

/* ---------- Tranzaksiyalar ---------- */
function readTx(b) {
  const type = b.type;
  const category = String(b.category || '').trim().slice(0, 50);
  const amount = num(b.amount);
  const note = String(b.note || '').trim().slice(0, 255);
  const date = b.date;
  if (!['income', 'expense'].includes(type)) return { error: 'Tur noto\'g\'ri' };
  if (!category) return { error: 'Kategoriyani tanlang' };
  if (!(amount > 0 && amount < 1e12)) return { error: 'Summa noto\'g\'ri' };
  if (!isDate(date)) return { error: 'Sana noto\'g\'ri' };
  return { v: [type, category, amount, note, date] };
}

app.get('/api/transactions', auth, h(async (req, res) => {
  const q = req.query;
  let sql = 'SELECT id,type,category,amount,note,`date` FROM transactions WHERE user_id=?';
  const p = [req.uid];
  if (['income', 'expense'].includes(q.type)) { sql += ' AND type=?'; p.push(q.type); }
  if (q.category) { sql += ' AND category=?'; p.push(String(q.category)); }
  if (q.q) { sql += ' AND (note LIKE ? OR category LIKE ?)'; p.push('%' + q.q + '%', '%' + q.q + '%'); }
  if (isDate(q.from)) { sql += ' AND `date`>=?'; p.push(q.from); }
  if (isDate(q.to)) { sql += ' AND `date`<=?'; p.push(q.to); }
  if (q.min !== undefined && q.min !== '' && num(q.min) >= 0) { sql += ' AND amount>=?'; p.push(num(q.min)); }
  if (q.max !== undefined && q.max !== '' && num(q.max) >= 0) { sql += ' AND amount<=?'; p.push(num(q.max)); }
  const limit = Math.min(parseInt(q.limit) || 1000, 5000);
  sql += ' ORDER BY `date` DESC, id DESC LIMIT ' + limit;
  const [rows] = await pool.query(sql, p);
  res.json(rows);
}));

app.post('/api/transactions', auth, h(async (req, res) => {
  const r = readTx(req.body || {});
  if (r.error) return res.status(400).json({ error: r.error });
  const [x] = await pool.query('INSERT INTO transactions (user_id,type,category,amount,note,`date`) VALUES (?,?,?,?,?,?)', [req.uid, ...r.v]);
  res.json({ id: x.insertId });
}));

app.put('/api/transactions/:id', auth, h(async (req, res) => {
  const r = readTx(req.body || {});
  if (r.error) return res.status(400).json({ error: r.error });
  await pool.query('UPDATE transactions SET type=?,category=?,amount=?,note=?,`date`=? WHERE id=? AND user_id=?', [...r.v, req.params.id, req.uid]);
  res.json({ ok: true });
}));

app.delete('/api/transactions/:id', auth, h(async (req, res) => {
  await pool.query('DELETE FROM transactions WHERE id=? AND user_id=?', [req.params.id, req.uid]);
  res.json({ ok: true });
}));

/* ---------- Statistika ---------- */
app.get('/api/stats', auth, h(async (req, res) => {
  const month = isMonth(req.query.month) ? req.query.month : mk(new Date());
  const [y, m] = month.split('-').map(Number);
  const keys = [];
  for (let i = 5; i >= 0; i--) keys.push(mk(new Date(y, m - 1 - i, 1)));

  const [bal] = await pool.query(
    "SELECT COALESCE(SUM(CASE WHEN type='income' THEN amount ELSE -amount END),0) AS balance FROM transactions WHERE user_id=?", [req.uid]);
  const [ms] = await pool.query(
    "SELECT DATE_FORMAT(`date`,'%Y-%m') AS m, type, SUM(amount) AS s FROM transactions WHERE user_id=? AND DATE_FORMAT(`date`,'%Y-%m') BETWEEN ? AND ? GROUP BY m, type",
    [req.uid, keys[0], keys[5]]);
  const months = keys.map((k) => ({
    m: k,
    income: Number((ms.find((r) => r.m === k && r.type === 'income') || {}).s || 0),
    expense: Number((ms.find((r) => r.m === k && r.type === 'expense') || {}).s || 0),
  }));
  const [cats] = await pool.query(
    "SELECT category, SUM(amount) AS total FROM transactions WHERE user_id=? AND type='expense' AND DATE_FORMAT(`date`,'%Y-%m')=? GROUP BY category ORDER BY total DESC",
    [req.uid, month]);
  res.json({ balance: Number(bal[0].balance), months, categories: cats.map((c) => ({ category: c.category, total: Number(c.total) })) });
}));

/* ---------- Byudjet ---------- */
app.get('/api/budgets', auth, h(async (req, res) => {
  const month = isMonth(req.query.month) ? req.query.month : mk(new Date());
  const [rows] = await pool.query(
    "SELECT b.id, b.category, b.limit_amount, b.month, (SELECT COALESCE(SUM(t.amount),0) FROM transactions t WHERE t.user_id=b.user_id AND t.type='expense' AND t.category=b.category AND DATE_FORMAT(t.`date`,'%Y-%m')=b.month) AS spent FROM budgets b WHERE b.user_id=? AND b.month=? ORDER BY b.id",
    [req.uid, month]);
  res.json(rows);
}));

app.post('/api/budgets', auth, h(async (req, res) => {
  const b = req.body || {};
  const category = String(b.category || '').trim().slice(0, 50);
  const limit = num(b.limit_amount);
  if (!category) return res.status(400).json({ error: 'Kategoriyani tanlang' });
  if (!(limit > 0 && limit < 1e12)) return res.status(400).json({ error: 'Limit noto\'g\'ri' });
  if (!isMonth(b.month)) return res.status(400).json({ error: 'Oy noto\'g\'ri' });
  const [ex] = await pool.query('SELECT id FROM budgets WHERE user_id=? AND category=? AND month=?', [req.uid, category, b.month]);
  if (ex.length) await pool.query('UPDATE budgets SET limit_amount=? WHERE id=?', [limit, ex[0].id]);
  else await pool.query('INSERT INTO budgets (user_id,category,limit_amount,month) VALUES (?,?,?,?)', [req.uid, category, limit, b.month]);
  res.json({ ok: true });
}));

app.delete('/api/budgets/:id', auth, h(async (req, res) => {
  await pool.query('DELETE FROM budgets WHERE id=? AND user_id=?', [req.params.id, req.uid]);
  res.json({ ok: true });
}));

/* ---------- Maqsadlar ---------- */
function readGoal(b) {
  const title = String(b.title || '').trim().slice(0, 100);
  const target = num(b.target_amount);
  const current = b.current_amount === '' || b.current_amount === undefined ? 0 : num(b.current_amount);
  const deadline = b.deadline ? b.deadline : null;
  if (!title) return { error: 'Maqsad nomini kiriting' };
  if (!(target > 0 && target < 1e12)) return { error: 'Maqsad summasi noto\'g\'ri' };
  if (!(current >= 0 && current < 1e12)) return { error: 'Joriy summa noto\'g\'ri' };
  if (deadline && !isDate(deadline)) return { error: 'Muddat noto\'g\'ri' };
  return { v: [title, target, current, deadline] };
}

app.get('/api/goals', auth, h(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM goals WHERE user_id=? ORDER BY id DESC', [req.uid]);
  res.json(rows);
}));
app.post('/api/goals', auth, h(async (req, res) => {
  const r = readGoal(req.body || {});
  if (r.error) return res.status(400).json({ error: r.error });
  await pool.query('INSERT INTO goals (user_id,title,target_amount,current_amount,deadline) VALUES (?,?,?,?,?)', [req.uid, ...r.v]);
  res.json({ ok: true });
}));
app.put('/api/goals/:id', auth, h(async (req, res) => {
  const r = readGoal(req.body || {});
  if (r.error) return res.status(400).json({ error: r.error });
  await pool.query('UPDATE goals SET title=?,target_amount=?,current_amount=?,deadline=? WHERE id=? AND user_id=?', [...r.v, req.params.id, req.uid]);
  res.json({ ok: true });
}));
app.post('/api/goals/:id/deposit', auth, h(async (req, res) => {
  const a = num((req.body || {}).amount);
  if (!(a > 0 && a < 1e12)) return res.status(400).json({ error: 'Summa noto\'g\'ri' });
  await pool.query('UPDATE goals SET current_amount=current_amount+? WHERE id=? AND user_id=?', [a, req.params.id, req.uid]);
  res.json({ ok: true });
}));
app.delete('/api/goals/:id', auth, h(async (req, res) => {
  await pool.query('DELETE FROM goals WHERE id=? AND user_id=?', [req.params.id, req.uid]);
  res.json({ ok: true });
}));

/* ---------- Namuna ma'lumotlar ---------- */
app.post('/api/demo', auth, h(async (req, res) => {
  const now = new Date();
  const today = ds(now);
  const rows = [];
  const push = (d, type, cat, amt, note) => { const s = ds(d); if (s <= today) rows.push([req.uid, type, cat, amt, note, s]); };
  for (let i = 2; i >= 0; i--) {
    const D = (d) => new Date(now.getFullYear(), now.getMonth() - i, d);
    push(D(1), 'income', 'Maosh', 8500000, 'Oylik maosh');
    push(D(3), 'expense', 'Oziq-ovqat', 420000, 'Korzinka');
    push(D(5), 'expense', 'Transport', 150000, 'Taksi');
    push(D(8), 'expense', 'Kommunal', 380000, 'Kommunal to\'lovlar');
    push(D(12), 'expense', 'O\'qish', 500000, 'Kurs to\'lovi');
    push(D(15), 'expense', 'Ko\'ngilochar', 250000, 'Kino va kafe');
    push(D(18), 'expense', 'Oziq-ovqat', 560000, 'Bozor');
    push(D(22), 'expense', 'Kiyim', 700000, 'Kiyim-kechak');
    push(D(25), 'expense', 'Salomatlik', 200000, 'Dorixona');
  }
  if (rows.length) await pool.query('INSERT INTO transactions (user_id,type,category,amount,note,`date`) VALUES ?', [rows]);
  const [bc] = await pool.query('SELECT COUNT(*) AS c FROM budgets WHERE user_id=?', [req.uid]);
  if (!bc[0].c) {
    const m = mk(now);
    await pool.query('INSERT INTO budgets (user_id,category,limit_amount,month) VALUES ?', [[
      [req.uid, 'Oziq-ovqat', 1200000, m], [req.uid, 'Transport', 300000, m], [req.uid, 'Ko\'ngilochar', 400000, m],
    ]]);
  }
  const [gc] = await pool.query('SELECT COUNT(*) AS c FROM goals WHERE user_id=?', [req.uid]);
  if (!gc[0].c) await pool.query('INSERT INTO goals (user_id,title,target_amount,current_amount) VALUES (?,?,?,?)', [req.uid, 'Noutbuk uchun', 8000000, 3200000]);
  res.json({ ok: true });
}));

app.get('/api/health', h(async (req, res) => { await pool.query('SELECT 1'); res.json({ ok: true }); }));

const PORT = process.env.PORT || 3000;
initDB()
  .then(() => app.listen(PORT, () => console.log(`🚀 http://localhost:${PORT}`)))
  .catch((err) => { console.error('❌ MySQL xatosi:', err.message); process.exit(1); });