/* ========== Sozlamalar va yordamchilar ========== */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MON = ['Yan', 'Fev', 'Mar', 'Apr', 'May', 'Iyun', 'Iyul', 'Avg', 'Sen', 'Okt', 'Noy', 'Dek'];
const TITLES = { dashboard: 'Dashboard', transactions: 'Tranzaksiyalar', budget: 'Byudjet', goals: 'Maqsadlar', reports: 'Hisobotlar', settings: 'Sozlamalar' };

const CATS = {
  expense: {
    'Oziq-ovqat': { icon: 'shopping-basket', color: '#F59E0B' },
    'Transport': { icon: 'car', color: '#6366F1' },
    'Kommunal': { icon: 'zap', color: '#0EA5E9' },
    "O'qish": { icon: 'book-open', color: '#EC4899' },
    "Ko'ngilochar": { icon: 'gamepad-2', color: '#8B5CF6' },
    'Salomatlik': { icon: 'heart-pulse', color: '#F43F5E' },
    'Kiyim': { icon: 'shirt', color: '#14B8A6' },
    'Boshqa': { icon: 'ellipsis', color: '#94A3B8' },
  },
  income: {
    'Maosh': { icon: 'banknote', color: '#10B981' },
    'Biznes': { icon: 'briefcase', color: '#0EA5E9' },
    "Sovg'a": { icon: 'gift', color: '#EC4899' },
    'Boshqa daromad': { icon: 'circle-plus', color: '#94A3B8' },
  },
};
const catInfo = (n) => CATS.expense[n] || CATS.income[n] || { icon: 'circle', color: '#94A3B8' };
const allCatNames = () => [...Object.keys(CATS.expense), ...Object.keys(CATS.income)];

let token = localStorage.getItem('token');
let user = null;
let view = (location.hash || '#dashboard').slice(1);
if (!TITLES[view]) view = 'dashboard';
let charts = [];
const cache = { tx: [], budgets: [], goals: [] };
const prefs = JSON.parse(localStorage.getItem('prefs') || '{}');
let ccy = prefs.ccy || 'UZS';
let rate = prefs.rate || 12700;
const savePrefs = () => localStorage.setItem('prefs', JSON.stringify({ ccy, rate }));

const nf = (n) => Math.round(n).toLocaleString('ru-RU');
const money = (n) => {
  n = Number(n) || 0;
  return ccy === 'USD'
    ? '$' + (n / rate).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : nf(n) + " so'm";
};
const pad = (n) => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const monthKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
const fdate = (s) => `${s.slice(8, 10)} ${MON[+s.slice(5, 7) - 1]} ${s.slice(0, 4)}`;
const mlabel = (m) => `${MON[+m.slice(5, 7) - 1]} ${m.slice(2, 4)}`;

function toast(msg, type = '') {
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  $('#toast').appendChild(t);
  setTimeout(() => t.remove(), 2800);
}

async function api(url, method = 'GET', body) {
  const r = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401 && token) { logout(); throw new Error('Sessiya tugadi, qayta kiring'); }
  if (!r.ok) throw new Error(d.error || 'Xatolik yuz berdi');
  return d;
}

/* ========== Tema ========== */
function applyTheme() {
  const dark = localStorage.getItem('theme') === 'dark';
  document.documentElement.toggleAttribute('data-theme', dark);
  if (dark) document.documentElement.setAttribute('data-theme', 'dark');
  $('#themeBtn').innerHTML = `<i data-lucide="${dark ? 'sun' : 'moon'}"></i>`;
  lucide.createIcons();
}
function toggleTheme() {
  localStorage.setItem('theme', localStorage.getItem('theme') === 'dark' ? 'light' : 'dark');
  applyTheme();
  if (user) render();
}

/* ========== Autentifikatsiya ========== */
function showAuth() {
  $('#app').classList.add('hidden');
  $('#auth').classList.remove('hidden');
  lucide.createIcons();
}
function showApp() {
  $('#auth').classList.add('hidden');
  $('#app').classList.remove('hidden');
  applyTheme();
  render();
}
function logout() {
  token = null; user = null;
  localStorage.removeItem('token');
  showAuth();
}
async function authSubmit(e, url, errId) {
  e.preventDefault();
  const btn = e.target.querySelector('button[type=submit]');
  $(errId).textContent = '';
  btn.disabled = true;
  try {
    const d = await api(url, 'POST', Object.fromEntries(new FormData(e.target)));
    token = d.token; user = d.user;
    localStorage.setItem('token', token);
    e.target.reset();
    showApp();
  } catch (err) { $(errId).textContent = err.message; }
  btn.disabled = false;
}
$('#loginForm').onsubmit = (e) => authSubmit(e, '/api/login', '#loginErr');
$('#registerForm').onsubmit = (e) => authSubmit(e, '/api/register', '#registerErr');
document.querySelectorAll('.tab').forEach((t) => (t.onclick = () => {
  document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
  $('#loginForm').classList.toggle('hidden', t.dataset.tab !== 'login');
  $('#registerForm').classList.toggle('hidden', t.dataset.tab !== 'register');
}));
$('#logoutBtn').onclick = logout;
$('#themeBtn').onclick = toggleTheme;

/* ========== Modal ========== */
function closeModal() { $('#modal').classList.remove('open'); $('#modal').innerHTML = ''; }
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
function openModal(title, html, onSubmit) {
  const m = $('#modal');
  m.innerHTML = `<div class="modal-box">
    <div class="modal-head"><h3>${title}</h3><button class="icon-btn" type="button" data-close><i data-lucide="x"></i></button></div>
    <form id="mForm">${html}<div class="err" id="mErr"></div><button class="btn full" type="submit">Saqlash</button></form></div>`;
  m.classList.add('open');
  lucide.createIcons();
  m.onclick = (e) => { if (e.target === m || e.target.closest('[data-close]')) closeModal(); };
  $('#mForm').onsubmit = async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    try { await onSubmit(Object.fromEntries(new FormData(e.target))); closeModal(); }
    catch (err) { $('#mErr').textContent = err.message; }
    btn.disabled = false;
  };
}

/* ========== Modallar ========== */
function txModal(t) {
  const edit = !!t;
  const type = t ? t.type : 'expense';
  openModal(edit ? 'Tranzaksiyani tahrirlash' : "Tranzaksiya qo'shish", `
    <div class="seg">
      <label><input type="radio" name="type" value="expense" ${type === 'expense' ? 'checked' : ''}><span>Xarajat</span></label>
      <label><input type="radio" name="type" value="income" ${type === 'income' ? 'checked' : ''}><span>Daromad</span></label>
    </div>
    <label class="f">Summa (so'mda)<input name="amount" type="number" min="1" step="any" required value="${t ? +t.amount : ''}"></label>
    <label class="f">Kategoriya<select name="category"></select></label>
    <label class="f">Sana<input name="date" type="date" required value="${t ? t.date : today()}"></label>
    <label class="f">Izoh<input name="note" maxlength="255" value="${esc(t ? t.note : '')}"></label>`,
    async (d) => {
      await api(edit ? '/api/transactions/' + t.id : '/api/transactions', edit ? 'PUT' : 'POST', d);
      toast('Saqlandi ✓'); render();
    });
  const fill = () => {
    const ty = $('input[name=type]:checked').value;
    $('select[name=category]').innerHTML = Object.keys(CATS[ty]).map((c) => `<option ${t && t.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('');
  };
  document.querySelectorAll('input[name=type]').forEach((r) => (r.onchange = fill));
  fill();
}

function budgetModal(b) {
  openModal('Byudjet limiti', `
    <label class="f">Kategoriya<select name="category">${Object.keys(CATS.expense).map((c) => `<option ${b && b.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
    <label class="f">Oylik limit (so'mda)<input name="limit_amount" type="number" min="1" step="any" required value="${b ? +b.limit_amount : ''}"></label>
    <input type="hidden" name="month" value="${bmonth}">`,
    async (d) => { await api('/api/budgets', 'POST', d); toast('Saqlandi ✓'); render(); });
}

function goalModal(g) {
  const edit = !!g;
  openModal(edit ? 'Maqsadni tahrirlash' : "Yangi maqsad", `
    <label class="f">Nomi<input name="title" required maxlength="100" placeholder="Masalan: Noutbuk uchun" value="${esc(g ? g.title : '')}"></label>
    <label class="f">Maqsad summasi (so'mda)<input name="target_amount" type="number" min="1" step="any" required value="${g ? +g.target_amount : ''}"></label>
    <label class="f">Hozirgi jamg'arma (so'mda)<input name="current_amount" type="number" min="0" step="any" value="${g ? +g.current_amount : 0}"></label>
    <label class="f">Muddat (ixtiyoriy)<input name="deadline" type="date" value="${g && g.deadline ? g.deadline : ''}"></label>`,
    async (d) => { await api(edit ? '/api/goals/' + g.id : '/api/goals', edit ? 'PUT' : 'POST', d); toast('Saqlandi ✓'); render(); });
}

function depositModal(g) {
  openModal("Jamg'armaga qo'shish: " + esc(g.title), `
    <label class="f">Summa (so'mda)<input name="amount" type="number" min="1" step="any" required autofocus></label>`,
    async (d) => { await api(`/api/goals/${g.id}/deposit`, 'POST', d); toast("Qo'shildi ✓"); render(); });
}

/* ========== Grafik yordamchilari ========== */
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
function mkChart(id, cfg) {
  Chart.defaults.font.family = "'Plus Jakarta Sans', sans-serif";
  Chart.defaults.color = css('--muted');
  charts.push(new Chart($(id), cfg));
}
const destroyCharts = () => { charts.forEach((c) => c.destroy()); charts = []; };
const tick = (v) => (ccy === 'USD' ? '$' + Math.round(v / rate) : (v / 1e6).toFixed(1).replace(/\.0$/, '') + ' mln');
const moneyTip = { callbacks: { label: (c) => `${c.dataset.label || c.label}: ${money(c.parsed.y ?? c.parsed)}` } };

function monthsChart(id, months, type) {
  mkChart(id, {
    type,
    data: {
      labels: months.map((x) => mlabel(x.m)),
      datasets: [
        { label: 'Daromad', data: months.map((x) => x.income), borderColor: '#10B981', backgroundColor: type === 'line' ? 'rgba(16,185,129,.12)' : '#10B981', fill: true, tension: .4, borderRadius: 8 },
        { label: 'Xarajat', data: months.map((x) => x.expense), borderColor: '#F43F5E', backgroundColor: type === 'line' ? 'rgba(244,63,94,.1)' : '#F43F5E', fill: true, tension: .4, borderRadius: 8 },
      ],
    },
    options: {
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { usePointStyle: true } }, tooltip: moneyTip },
      scales: { y: { beginAtZero: true, grid: { color: css('--border') }, ticks: { callback: tick } }, x: { grid: { display: false } } },
    },
  });
}
function donutChart(id, cats) {
  mkChart(id, {
    type: 'doughnut',
    data: { labels: cats.map((c) => c.category), datasets: [{ data: cats.map((c) => c.total), backgroundColor: cats.map((c) => catInfo(c.category).color), borderWidth: 0 }] },
    options: {
      maintainAspectRatio: false, cutout: '68%',
      plugins: { legend: { position: 'bottom', labels: { usePointStyle: true } }, tooltip: { callbacks: { label: (c) => `${c.label}: ${money(c.parsed)}` } } },
    },
  });
}

/* ========== Umumiy qismlar ========== */
const txRow = (t, actions) => {
  const c = catInfo(t.category), inc = t.type === 'income';
  return `<li>
    <div class="tx-ico" style="background:${c.color}"><i data-lucide="${c.icon}"></i></div>
    <div class="tx-info"><b>${esc(t.note || t.category)}</b><span>${esc(t.category)} · ${fdate(t.date)}</span></div>
    <span class="${inc ? 'plus' : 'minus'}">${inc ? '+' : '−'}${money(t.amount)}</span>
    ${actions ? `<div class="row-act">
      <button class="mini" data-act="edit-tx" data-id="${t.id}" aria-label="Tahrirlash"><i data-lucide="pencil"></i></button>
      <button class="mini del" data-act="del-tx" data-id="${t.id}" aria-label="O'chirish"><i data-lucide="trash-2"></i></button></div>` : ''}
  </li>`;
};
const emptyBox = (icon, text, btns = '') => `<div class="empty"><i data-lucide="${icon}"></i><p>${text}</p>${btns}</div>`;
const demoBtn = `<button class="btn ghost" data-act="demo"><i data-lucide="sparkles"></i> Namuna ma'lumot</button>`;

function exportCSV(list) {
  const rows = [['Sana', 'Tur', 'Kategoriya', 'Summa (UZS)', 'Izoh'], ...list.map((t) => [t.date, t.type === 'income' ? 'Daromad' : 'Xarajat', t.category, t.amount, t.note || ''])];
  const csv = rows.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
  a.download = 'byudjetim.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* ========== Sahifalar ========== */
const views = {};
let bmonth = monthKey();
let rmonth = monthKey();
const filters = { q: '', type: '', category: '', from: '', to: '', min: '', max: '' };

views.dashboard = async (v) => {
  const [s, txs] = await Promise.all([api('/api/stats'), api('/api/transactions?limit=6')]);
  const cur = s.months[s.months.length - 1];
  v.innerHTML = `
    <section class="cards">
      <article class="card hero"><div class="ico"><i data-lucide="wallet"></i></div><p>Umumiy balans</p><h2>${money(s.balance)}</h2>
        <small>Shu oy: ${cur.income - cur.expense >= 0 ? '+' : '−'}${money(Math.abs(cur.income - cur.expense))}</small></article>
      <article class="card"><div class="ico green"><i data-lucide="trending-up"></i></div><p>Oylik daromad</p><h2>${money(cur.income)}</h2></article>
      <article class="card"><div class="ico red"><i data-lucide="trending-down"></i></div><p>Oylik xarajat</p><h2>${money(cur.expense)}</h2></article>
    </section>
    <section class="grid">
      <article class="card"><h3>Daromad va xarajat</h3><div class="chart-box"><canvas id="lineChart"></canvas></div></article>
      <article class="card"><h3>Xarajatlar kategoriyasi</h3>
        ${s.categories.length ? '<div class="chart-box"><canvas id="donutChart"></canvas></div>' : emptyBox('pie-chart', "Bu oyda xarajat yo'q")}</article>
    </section>
    <section class="card"><h3>Oxirgi tranzaksiyalar</h3>
      ${txs.length ? `<ul class="tx-list">${txs.map((t) => txRow(t, false)).join('')}</ul>`
        : emptyBox('inbox', "Hali tranzaksiya yo'q", `<button class="btn" data-act="add-tx"><i data-lucide="plus"></i> Qo'shish</button>${demoBtn}`)}
    </section>`;
  monthsChart('#lineChart', s.months, 'line');
  if (s.categories.length) donutChart('#donutChart', s.categories);
};

views.transactions = async (v) => {
  const opt = (arr, sel) => arr.map((c) => `<option ${c === sel ? 'selected' : ''}>${esc(c)}</option>`).join('');
  v.innerHTML = `<section class="card">
    <div class="filters">
      <input id="fq" placeholder="Qidiruv…" value="${esc(filters.q)}">
      <select id="ft"><option value="">Barcha tur</option><option value="income" ${filters.type === 'income' ? 'selected' : ''}>Daromad</option><option value="expense" ${filters.type === 'expense' ? 'selected' : ''}>Xarajat</option></select>
      <select id="fc"><option value="">Barcha kategoriya</option>${opt(allCatNames(), filters.category)}</select>
      <input id="ff" type="date" title="Dan" value="${filters.from}">
      <input id="fto" type="date" title="Gacha" value="${filters.to}">
      <input id="fmin" type="number" placeholder="Min summa" value="${filters.min}">
      <input id="fmax" type="number" placeholder="Max summa" value="${filters.max}">
      <button class="btn ghost" id="fexp"><i data-lucide="download"></i> Excel</button>
    </div>
    <ul id="txBody" class="tx-list"></ul>
    <p class="muted" id="txSum" style="margin-top:12px"></p></section>`;
  const load = async () => {
    const p = new URLSearchParams();
    Object.entries(filters).forEach(([k, val]) => val && p.set(k, val));
    const list = await api('/api/transactions?' + p);
    cache.tx = list;
    $('#txBody').innerHTML = list.length ? list.map((t) => txRow(t, true)).join('')
      : emptyBox('search-x', 'Tranzaksiya topilmadi', `<button class="btn" data-act="add-tx"><i data-lucide="plus"></i> Qo'shish</button>`);
    const inc = list.filter((t) => t.type === 'income').reduce((a, t) => a + +t.amount, 0);
    const exp = list.filter((t) => t.type === 'expense').reduce((a, t) => a + +t.amount, 0);
    $('#txSum').textContent = list.length ? `Jami: ${list.length} ta · Daromad: ${money(inc)} · Xarajat: ${money(exp)}` : '';
    lucide.createIcons();
  };
  let timer;
  const bind = { fq: 'q', ft: 'type', fc: 'category', ff: 'from', fto: 'to', fmin: 'min', fmax: 'max' };
  Object.entries(bind).forEach(([id, key]) => {
    $('#' + id).oninput = (e) => { filters[key] = e.target.value; clearTimeout(timer); timer = setTimeout(() => load().catch((er) => toast(er.message, 'err')), 250); };
  });
  $('#fexp').onclick = () => (cache.tx.length ? exportCSV(cache.tx) : toast("Eksport uchun ma'lumot yo'q", 'err'));
  await load();
};

views.budget = async (v) => {
  const list = await api('/api/budgets?month=' + bmonth);
  cache.budgets = list;
  const totalL = list.reduce((a, b) => a + +b.limit_amount, 0);
  const totalS = list.reduce((a, b) => a + +b.spent, 0);
  const alerts = list.filter((b) => +b.spent >= +b.limit_amount * 0.8)
    .map((b) => `<div class="alert ${+b.spent >= +b.limit_amount ? 'bad' : ''}">${+b.spent >= +b.limit_amount ? '⚠️ Limit oshib ketdi' : '⚠️ Limitga yaqinlashdingiz'}: ${esc(b.category)}</div>`).join('');
  v.innerHTML = `
    <div class="bar"><input type="month" id="bm" value="${bmonth}">
      <button class="btn" data-act="add-budget"><i data-lucide="plus"></i> Limit qo'shish</button></div>
    ${alerts}
    ${list.length ? `<section class="card"><h3>Umumiy: ${money(totalS)} / ${money(totalL)}</h3>
      <div class="pbar ${totalS >= totalL ? 'bad' : totalS >= totalL * .8 ? 'warn' : ''}"><i style="width:${Math.min(100, totalL ? totalS / totalL * 100 : 0)}%"></i></div></section>
      <div class="grid3">${list.map((b) => {
        const l = +b.limit_amount, s = +b.spent, p = l ? s / l * 100 : 0, c = catInfo(b.category);
        const cls = p >= 100 ? 'bad' : p >= 80 ? 'warn' : '';
        return `<article class="card">
          <div class="b-top"><div class="tx-ico" style="background:${c.color}"><i data-lucide="${c.icon}"></i></div>
            <div class="row-act"><button class="mini" data-act="edit-budget" data-id="${b.id}"><i data-lucide="pencil"></i></button>
            <button class="mini del" data-act="del-budget" data-id="${b.id}"><i data-lucide="trash-2"></i></button></div></div>
          <h3 style="margin-bottom:0">${esc(b.category)}</h3>
          <div class="pbar ${cls}"><i style="width:${Math.min(100, p)}%"></i></div>
          <div class="goal-nums"><b>${money(s)}</b><span>/ ${money(l)}</span></div>
          <span class="badge ${cls}">${p.toFixed(0)}% · ${p >= 100 ? 'Limit oshdi' : p >= 80 ? 'Yaqinlashdi' : 'Yaxshi'}</span></article>`;
      }).join('')}</div>`
      : `<section class="card">${emptyBox('pie-chart', "Bu oy uchun limit belgilanmagan", `<button class="btn" data-act="add-budget"><i data-lucide="plus"></i> Limit qo'shish</button>`)}</section>`}`;
  $('#bm').onchange = (e) => { if (e.target.value) { bmonth = e.target.value; render(); } };
};

views.goals = async (v) => {
  const list = await api('/api/goals');
  cache.goals = list;
  v.innerHTML = `<div class="bar"><span></span><button class="btn" data-act="add-goal"><i data-lucide="plus"></i> Yangi maqsad</button></div>
    ${list.length ? `<div class="grid3">${list.map((g) => {
      const t = +g.target_amount, c = +g.current_amount, p = Math.min(100, t ? c / t * 100 : 0), done = c >= t;
      let dl = '';
      if (g.deadline) { const d = Math.ceil((new Date(g.deadline) - new Date()) / 864e5); dl = d >= 0 ? ` · ${d} kun qoldi` : " · Muddat o'tgan"; }
      return `<article class="card">
        <div class="goal-top"><div class="ico green"><i data-lucide="${done ? 'trophy' : 'target'}"></i></div>
          <div class="row-act"><button class="mini" data-act="deposit" data-id="${g.id}" title="Pul qo'shish"><i data-lucide="piggy-bank"></i></button>
          <button class="mini" data-act="edit-goal" data-id="${g.id}"><i data-lucide="pencil"></i></button>
          <button class="mini del" data-act="del-goal" data-id="${g.id}"><i data-lucide="trash-2"></i></button></div></div>
        <h3 style="margin-bottom:0">${esc(g.title)}</h3>
        <div class="pbar"><i style="width:${p}%"></i></div>
        <div class="goal-nums"><b>${money(c)}</b><span>/ ${money(t)}</span></div>
        <small class="muted">${p.toFixed(0)}% ${done ? '· Erishildi 🎉' : dl}</small></article>`;
    }).join('')}</div>`
      : `<section class="card">${emptyBox('target', "Hali maqsad yo'q", `<button class="btn" data-act="add-goal"><i data-lucide="plus"></i> Maqsad qo'shish</button>`)}</section>`}`;
};

views.reports = async (v) => {
  const s = await api('/api/stats?month=' + rmonth);
  const a = s.months[4], b = s.months[5];
  const pct = (n, o) => (o ? ((n - o) / o * 100) : (n ? 100 : 0));
  const card = (label, n, o, goodUp) => {
    const p = pct(n, o), up = p >= 0, good = goodUp ? up : !up;
    return `<article class="card"><p style="margin-top:0">${label}</p><h2>${money(n)}</h2>
      <small class="${good ? 'up' : 'down'}">${up ? '▲' : '▼'} ${Math.abs(p).toFixed(0)}% o'tgan oyga nisbatan</small></article>`;
  };
  const top = s.categories[0];
  v.innerHTML = `
    <div class="bar"><input type="month" id="rm" value="${rmonth}">
      <div class="actions"><button class="btn ghost" id="rexp"><i data-lucide="download"></i> Excel</button>
      <button class="btn ghost" id="rpdf"><i data-lucide="file-text"></i> PDF</button></div></div>
    <section class="cmp">
      ${card('Daromad', b.income, a.income, true)}
      ${card('Xarajat', b.expense, a.expense, false)}
      <article class="card"><p style="margin-top:0">Eng ko'p xarajat</p><h2>${top ? esc(top.category) : '—'}</h2><small class="muted">${top ? money(top.total) : "Ma'lumot yo'q"}</small></article>
    </section>
    <section class="grid">
      <article class="card"><h3>Oylar bo'yicha taqqoslash</h3><div class="chart-box"><canvas id="barChart"></canvas></div></article>
      <article class="card"><h3>Xarajatlar kategoriyasi</h3>
        ${s.categories.length ? '<div class="chart-box"><canvas id="donutChart"></canvas></div>' : emptyBox('pie-chart', "Bu oyda xarajat yo'q")}</article>
    </section>`;
  monthsChart('#barChart', s.months, 'bar');
  if (s.categories.length) donutChart('#donutChart', s.categories);
  $('#rm').onchange = (e) => { if (e.target.value) { rmonth = e.target.value; render(); } };
  $('#rpdf').onclick = () => window.print();
  $('#rexp').onclick = async () => {
    const all = await api('/api/transactions?limit=5000');
    all.length ? exportCSV(all) : toast("Eksport uchun ma'lumot yo'q", 'err');
  };
};

views.settings = async (v) => {
  v.innerHTML = `<div class="set-grid">
    <section class="card"><h3>Profil</h3>
      <form id="pf"><label class="f">Email<input value="${esc(user.email)}" disabled></label>
        <label class="f">Ism<input name="name" required maxlength="100" value="${esc(user.name)}"></label>
        <div class="err" id="pfE"></div><button class="btn" type="submit">Saqlash</button></form></section>
    <section class="card"><h3>Ko'rinish va valyuta</h3>
      <form id="cf"><label class="f">Valyuta<select name="ccy"><option value="UZS" ${ccy === 'UZS' ? 'selected' : ''}>So'm (UZS)</option><option value="USD" ${ccy === 'USD' ? 'selected' : ''}>Dollar (USD)</option></select></label>
        <label class="f">1 dollar necha so'm<input name="rate" type="number" min="1" step="any" value="${rate}"></label>
        <button class="btn" type="submit">Saqlash</button></form>
      <p class="muted" style="margin-top:16px">Tema: yuqoridagi oy/quyosh tugmasi orqali almashadi.</p></section>
    <section class="card"><h3>Parolni o'zgartirish</h3>
      <form id="pw"><label class="f">Eski parol<input name="old" type="password" required></label>
        <label class="f">Yangi parol<input name="new" type="password" required minlength="6"></label>
        <div class="err" id="pwE"></div><button class="btn" type="submit">O'zgartirish</button></form></section>
    <section class="card"><h3>Boshqa</h3>
      <p class="muted" style="margin:0 0 14px">Dastur qanday ishlashini ko'rish uchun namuna ma'lumotlar qo'shing.</p>
      ${demoBtn}<br><br><button class="btn danger" id="lo"><i data-lucide="log-out"></i> Chiqish</button></section></div>`;
  $('#pf').onsubmit = async (e) => {
    e.preventDefault();
    try { const d = await api('/api/me', 'PUT', Object.fromEntries(new FormData(e.target))); user.name = d.name; toast('Saqlandi ✓'); }
    catch (er) { $('#pfE').textContent = er.message; }
  };
  $('#cf').onsubmit = (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    ccy = d.ccy; rate = +d.rate || 12700; savePrefs(); toast('Saqlandi ✓');
  };
  $('#pw').onsubmit = async (e) => {
    e.preventDefault(); $('#pwE').textContent = '';
    try { await api('/api/password', 'PUT', Object.fromEntries(new FormData(e.target))); e.target.reset(); toast("Parol o'zgartirildi ✓"); }
    catch (er) { $('#pwE').textContent = er.message; }
  };
  $('#lo').onclick = logout;
};

/* ========== Render va navigatsiya ========== */
async function render() {
  destroyCharts();
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.view === view));
  $('#pageTitle').textContent = view === 'dashboard' ? `Salom, ${user.name.split(' ')[0]} 👋` : TITLES[view];
  $('#pageSub').textContent = view === 'dashboard' ? "Har bir so'm hisobda" : 'Byudjetim';
  const v = $('#view');
  v.innerHTML = '<div class="loading">Yuklanmoqda…</div>';
  try { await views[view](v); }
  catch (e) { v.innerHTML = `<div class="card">${emptyBox('alert-circle', esc(e.message))}</div>`; }
  lucide.createIcons();
}
function go(name) { view = name; location.hash = name; render(); window.scrollTo(0, 0); }

/* ========== Tugmalar (event delegation) ========== */
document.addEventListener('click', async (e) => {
  const nav = e.target.closest('[data-view]');
  if (nav) { e.preventDefault(); go(nav.dataset.view); return; }
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act, id = b.dataset.id;
  try {
    if (act === 'add-tx') txModal();
    else if (act === 'edit-tx') txModal(cache.tx.find((t) => t.id == id));
    else if (act === 'del-tx') { if (confirm("Tranzaksiya o'chirilsinmi?")) { await api('/api/transactions/' + id, 'DELETE'); toast("O'chirildi"); render(); } }
    else if (act === 'add-budget') budgetModal();
    else if (act === 'edit-budget') budgetModal(cache.budgets.find((x) => x.id == id));
    else if (act === 'del-budget') { if (confirm("Limit o'chirilsinmi?")) { await api('/api/budgets/' + id, 'DELETE'); toast("O'chirildi"); render(); } }
    else if (act === 'add-goal') goalModal();
    else if (act === 'edit-goal') goalModal(cache.goals.find((x) => x.id == id));
    else if (act === 'deposit') depositModal(cache.goals.find((x) => x.id == id));
    else if (act === 'del-goal') { if (confirm("Maqsad o'chirilsinmi?")) { await api('/api/goals/' + id, 'DELETE'); toast("O'chirildi"); render(); } }
    else if (act === 'demo') { await api('/api/demo', 'POST'); toast("Namuna ma'lumotlar qo'shildi ✓"); render(); }
  } catch (err) { toast(err.message, 'err'); }
});

/* ========== Ishga tushirish ========== */
(async function init() {
  lucide.createIcons();
  applyTheme();
  if (!token) return showAuth();
  try { user = await api('/api/me'); showApp(); }
  catch { showAuth(); }
})();