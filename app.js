import firebaseConfig from './firebase-config.js';
import * as calc from './calc.js';
import { parseMyCar } from './import.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail, signOut,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, setDoc, updateDoc, deleteDoc, getDoc, onSnapshot,
  writeBatch, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// ---------- Firebase ----------
const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = initializeFirestore(fbApp, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

// ---------- Constants ----------
const SERVICE_CATS = ['Scheduled service', 'Tyres', 'Repairs', 'Brakes', 'Battery', 'Oil change', 'Wheel alignment', 'Other service'];
const EXPENSE_CATS = ['Registration', 'Insurance', 'Tolls', 'Parking', 'Car wash', 'Accessories', 'Fines', 'Roadside assist', 'Other'];
const TYPE_LABEL = { fuel: 'Fuel', service: 'Service', expense: 'Expense' };
const ICONS = {
  fuel: '<svg viewBox="0 0 24 24"><path d="M4 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16M3 21h13M4 10h11M15 8h2a2 2 0 0 1 2 2v7a1.5 1.5 0 0 0 3 0V9l-3-3"/></svg>',
  service: '<svg viewBox="0 0 24 24"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/></svg>',
  expense: '<svg viewBox="0 0 24 24"><path d="M4 7h16v12H4zM4 11h16M8 15h3"/></svg>',
};

// ---------- State ----------
const state = {
  user: null,
  vehicles: [],
  entries: [],
  vehicleId: null,
  view: 'home',
  logFilter: 'all',
  unsub: [],
  charts: [],
};

// ---------- Helpers ----------
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' });
const money0 = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 });
const n0 = new Intl.NumberFormat('en-AU', { maximumFractionDigits: 0 });
const n1 = new Intl.NumberFormat('en-AU', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const n2 = new Intl.NumberFormat('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = () => new Date().toLocaleDateString('en-CA');
const fmtDate = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
const fmtMonth = (ym) => new Date(ym + '-01T00:00:00').toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
const numOrNull = (v) => (v === '' || v === null || v === undefined || isNaN(+v) ? null : +v);
const userCol = (name) => collection(db, 'users', state.user.uid, name);
const userDoc = (name, id) => doc(db, 'users', state.user.uid, name, id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2200);
}

const currentVehicle = () => state.vehicles.find((v) => v.id === state.vehicleId) || null;
const vehicleEntries = () => state.entries.filter((e) => e.vehicleId === state.vehicleId);
const sortDesc = (list) => [...list].sort((a, b) => String(b.date).localeCompare(String(a.date)) || (+b.odo || 0) - (+a.odo || 0));

// ---------- Auth ----------
const authMsg = (m) => { $('#auth-msg').textContent = m; };
const niceAuthError = (e) => ({
  'auth/invalid-credential': 'Email or password is incorrect.',
  'auth/wrong-password': 'Email or password is incorrect.',
  'auth/user-not-found': 'No account with that email yet. Tap “Create account”.',
  'auth/email-already-in-use': 'That email already has an account. Sign in instead.',
  'auth/weak-password': 'Password needs at least 6 characters.',
  'auth/network-request-failed': 'No internet connection.',
}[e.code] ?? e.message);

$('#email-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  authMsg('');
  const f = ev.target;
  const mode = ev.submitter?.value || 'signin';
  try {
    if (mode === 'signup') await createUserWithEmailAndPassword(auth, f.email.value.trim(), f.password.value);
    else await signInWithEmailAndPassword(auth, f.email.value.trim(), f.password.value);
  } catch (e) { authMsg(niceAuthError(e)); }
});

$('#reset-btn').addEventListener('click', async () => {
  const email = $('#email-form').email.value.trim();
  if (!email) return authMsg('Type your email above first.');
  try { await sendPasswordResetEmail(auth, email); authMsg(''); toast('Password reset email sent'); }
  catch (e) { authMsg(niceAuthError(e)); }
});

onAuthStateChanged(auth, (user) => {
  state.unsub.forEach((u) => u());
  state.unsub = [];
  state.user = user;
  $('#auth').hidden = !!user;
  $('#app').hidden = !user;
  if (user) startData();
});

// ---------- Data ----------
function startData() {
  state.vehicleId = store.get('carlog.vehicle');
  let gotVehicles = false, gotEntries = false;
  state.unsub.push(onSnapshot(userCol('vehicles'), { includeMetadataChanges: true }, (snap) => {
    state.vehicles = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
    if (!state.vehicles.some((v) => v.id === state.vehicleId)) state.vehicleId = state.vehicles[0]?.id || null;
    $('#sync-dot').classList.toggle('offline', snap.metadata.fromCache || snap.metadata.hasPendingWrites);
    $('#sync-dot').title = snap.metadata.hasPendingWrites ? 'Saved on phone, waiting to sync' : 'Synced';
    gotVehicles = true;
    if (gotEntries) render();
  }));
  state.unsub.push(onSnapshot(userCol('entries'), (snap) => {
    state.entries = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    gotEntries = true;
    if (gotVehicles) render();
  }));
}

// Writes return straight away: Firestore applies them on the phone first and syncs
// when there's signal, so nothing here waits on the network.
function saveVehicle(data, id) {
  if (id) return updateDoc(userDoc('vehicles', id), data);
  const ref = doc(userCol('vehicles'));
  state.vehicleId = ref.id;
  store.set('carlog.vehicle', ref.id);
  return setDoc(ref, { ...data, createdAt: serverTimestamp() });
}

async function deleteVehicle(id) {
  const ids = state.entries.filter((e) => e.vehicleId === id).map((e) => e.id);
  // Firestore batches cap at 500 writes; each entry may also have a receipt doc.
  for (let i = 0; i < ids.length; i += 200) {
    const b = writeBatch(db);
    for (const eid of ids.slice(i, i + 200)) { b.delete(userDoc('entries', eid)); b.delete(userDoc('receipts', eid)); }
    await b.commit();
  }
  await deleteDoc(userDoc('vehicles', id));
}

function saveEntry(data, id, receipt) {
  // receipt: undefined = unchanged, null = remove, string = new image data URL
  const ref = id ? userDoc('entries', id) : doc(userCol('entries'));
  const b = writeBatch(db);
  if (receipt === null) data.hasReceipt = false;
  if (typeof receipt === 'string') data.hasReceipt = true;
  if (id) b.update(ref, { ...data, updatedAt: serverTimestamp() });
  else b.set(ref, { ...data, createdAt: serverTimestamp() });
  if (receipt === null) b.delete(userDoc('receipts', ref.id));
  else if (typeof receipt === 'string') b.set(userDoc('receipts', ref.id), { image: receipt, vehicleId: data.vehicleId });
  return b.commit();
}

function deleteEntry(id) {
  const b = writeBatch(db);
  b.delete(userDoc('entries', id));
  b.delete(userDoc('receipts', id));
  return b.commit();
}

// Shrinks a photo so it fits comfortably inside a Firestore document (1 MB limit).
async function compressImage(file) {
  const bmp = await createImageBitmap(file);
  let max = 1400, quality = 0.7, url = '';
  for (let i = 0; i < 6; i++) {
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    url = c.toDataURL('image/jpeg', quality);
    if (url.length < 700_000) break;
    max *= 0.8; quality = Math.max(0.4, quality - 0.1);
  }
  return url;
}

// ---------- Rendering ----------
function render() {
  const sel = $('#vehicle-select');
  sel.innerHTML = state.vehicles.length
    ? state.vehicles.map((v) => `<option value="${v.id}" ${v.id === state.vehicleId ? 'selected' : ''}>${esc(v.name)}</option>`).join('')
    : '<option>No vehicles yet</option>';
  sel.disabled = !state.vehicles.length;
  $('#fab').hidden = !state.vehicles.length || state.view === 'garage';
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));

  state.charts.forEach((c) => c.destroy());
  state.charts = [];
  const main = $('#main');
  if (!state.vehicles.length && state.view !== 'garage') { main.innerHTML = welcomeHTML(); return; }
  if (state.view === 'home') main.innerHTML = homeHTML();
  else if (state.view === 'log') main.innerHTML = logHTML();
  else if (state.view === 'charts') { main.innerHTML = chartsHTML(); drawCharts(); }
  else main.innerHTML = garageHTML();
}

function welcomeHTML() {
  return `<div class="card empty">
    <h2>Add your first vehicle</h2>
    <p>Start with the van, then add any other cars you want to track.</p>
    <button class="btn primary" data-act="add-vehicle">Add vehicle</button>
  </div>`;
}

function entryRow(e) {
  let title = TYPE_LABEL[e.type], sub = [];
  if (e.type === 'fuel') {
    title = e.litres ? `${n2.format(e.litres)} L` : 'Fuel';
    if (e.litres > 0 && e.cost > 0) sub.push(`${n2.format((e.cost / e.litres) * 100)} c/L`);
    if (e.fullTank === false) sub.push('partial');
  } else title = e.category || title;
  sub.unshift(fmtDate(e.date));
  if (e.odo) sub.push(`${n0.format(e.odo)} km`);
  if (e.place) sub.push(esc(e.place));
  return `<button class="entry" data-act="edit-entry" data-id="${e.id}">
    <span class="badge ${e.type}">${ICONS[e.type]}</span>
    <span><span class="t">${esc(title)}${e.hasReceipt ? ' 📎' : ''}</span><br><span class="s">${sub.join(' · ')}</span></span>
    <span class="amt num">${e.cost != null ? money.format(e.cost) : ''}</span>
  </button>`;
}

function homeHTML() {
  const list = vehicleEntries();
  const s = calc.summary(list);
  const v = currentVehicle();
  const year = new Date().getFullYear();
  const ytd = list.filter((e) => String(e.date).startsWith(String(year))).reduce((a, e) => a + (+e.cost || 0), 0);
  const t = s.totals, tot = s.total || 1;
  const recent = sortDesc(list).slice(0, 6);
  return `
    <section class="card hero">
      <span class="muted small">${esc(v.name)}${v.rego ? ' · ' + esc(v.rego) : ''}</span>
      <span class="big num">${money0.format(ytd)}</span>
      <span class="muted small">spent in ${year} · ${money0.format(s.total)} all time</span>
      ${s.total ? `<div class="split" aria-hidden="true">
        <span style="flex:${t.fuel / tot};background:var(--fuel)"></span>
        <span style="flex:${t.service / tot};background:var(--service)"></span>
        <span style="flex:${t.expense / tot};background:var(--expense)"></span>
      </div>
      <div class="legend">
        <span><i style="background:var(--fuel)"></i>Fuel ${money0.format(t.fuel)}</span>
        <span><i style="background:var(--service)"></i>Service ${money0.format(t.service)}</span>
        <span><i style="background:var(--expense)"></i>Other ${money0.format(t.expense)}</span>
      </div>` : ''}
    </section>
    <section class="stats">
      <div class="stat"><div class="v num">${s.avgL100 != null ? n1.format(s.avgL100) : '–'}</div><div class="k">Avg L/100km</div></div>
      <div class="stat"><div class="v num">${s.lastL100 != null ? n1.format(s.lastL100) : '–'}</div><div class="k">Last tank L/100km</div></div>
      <div class="stat"><div class="v num">${s.costPerKm != null ? n0.format(s.costPerKm * 100) + 'c' : '–'}</div><div class="k">Running cost per km</div></div>
      <div class="stat"><div class="v num">${s.lastOdo != null ? n0.format(s.lastOdo) : '–'}</div><div class="k">Odometer (km)</div></div>
    </section>
    <section class="card">
      <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:.25rem">
        <h2 style="margin:0">Recent</h2>
        ${list.length > 6 ? '<button class="link" data-act="go-log">See all</button>' : ''}
      </div>
      ${recent.length ? `<div class="list">${recent.map(entryRow).join('')}</div>`
        : '<p class="empty">Nothing logged yet. Tap + to add your first fill-up.</p>'}
    </section>`;
}

function logHTML() {
  const f = state.logFilter;
  const list = sortDesc(vehicleEntries().filter((e) => f === 'all' || e.type === f));
  const chips = ['all', 'fuel', 'service', 'expense']
    .map((k) => `<button class="chip ${f === k ? 'on' : ''}" data-act="filter" data-f="${k}">${k === 'all' ? 'All' : TYPE_LABEL[k]}</button>`).join('');
  let html = '', month = null, monthTotal = {};
  for (const e of list) monthTotal[String(e.date).slice(0, 7)] = (monthTotal[String(e.date).slice(0, 7)] || 0) + (+e.cost || 0);
  for (const e of list) {
    const m = String(e.date).slice(0, 7);
    if (m !== month) { month = m; html += `<div class="month-head"><span>${fmtMonth(m)}</span><span class="num">${money.format(monthTotal[m])}</span></div>`; }
    html += entryRow(e);
  }
  return `<div class="chips">${chips}</div>
    <section class="card" style="padding-top:4px">${list.length ? `<div class="list">${html}</div>` : '<p class="empty">No entries.</p>'}</section>`;
}

function chartsHTML() {
  const list = vehicleEntries();
  if (!list.length) return '<p class="card empty">Log a few entries and your charts will appear here.</p>';
  const econ = calc.fuelEconomy(list);
  return `
    <section class="card"><h2>Fuel economy (L/100km)</h2>
      ${econ.length > 1 ? '<div class="chart-box"><canvas id="c-econ"></canvas></div>'
        : `<p class="muted small">${econ.length ? `First result: ${n1.format(econ[0].l100)} L/100km. ` : ''}The trend line appears after a few more full-tank fill-ups logged with litres.</p>`}
    </section>
    <section class="card"><h2>Monthly spending, last 12 months</h2>
      <div class="chart-box"><canvas id="c-month"></canvas></div>
    </section>
    <section class="card"><h2>Where the money goes</h2>
      <div class="chart-box" id="cat-box"><canvas id="c-cat"></canvas></div>
    </section>
    <section class="card"><h2>Fuel price paid (c/L)</h2>
      <div class="chart-box"><canvas id="c-ppl"></canvas></div>
    </section>`;
}

function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

function drawCharts() {
  if (!window.Chart) { setTimeout(() => state.view === 'charts' && render(), 300); return; }
  const list = vehicleEntries();
  const C = { text: cssVar('--text-2'), grid: cssVar('--grid'), surface: cssVar('--surface'), fuel: cssVar('--fuel'), service: cssVar('--service'), expense: cssVar('--expense') };
  Chart.defaults.color = C.text;
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  const base = {
    responsive: true, maintainAspectRatio: false, animation: false,
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { display: false } },
    scales: {
      x: { grid: { display: false }, border: { color: C.grid }, ticks: { maxRotation: 0, autoSkipPadding: 12 } },
      y: { grid: { color: C.grid }, border: { display: false } },
    },
  };
  const shortDate = (d) => new Date(d + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit' });
  const line = (color, n = 0) => ({ borderColor: color, backgroundColor: color, borderWidth: 2, pointRadius: n > 40 ? 0 : 3, pointHitRadius: 8, pointHoverRadius: 5, tension: 0.25 });

  const econ = calc.fuelEconomy(list);
  if (econ.length > 1 && $('#c-econ')) {
    state.charts.push(new Chart($('#c-econ'), {
      type: 'line',
      data: { labels: econ.map((p) => shortDate(p.date)), datasets: [{ label: 'L/100km', data: econ.map((p) => +p.l100.toFixed(2)), ...line(C.fuel, econ.length) }] },
      options: { ...base, plugins: { ...base.plugins, tooltip: { callbacks: {
        label: (ctx) => `${n1.format(ctx.parsed.y)} L/100km`,
        afterLabel: (ctx) => `${n0.format(econ[ctx.dataIndex].distance)} km on ${n1.format(econ[ctx.dataIndex].litres)} L`,
      } } } },
    }));
  }

  const months = calc.monthly(list, 12);
  const bar = (label, key, color) => ({ label, data: months.map((m) => +m[key].toFixed(2)), backgroundColor: color, borderColor: C.surface, borderWidth: { top: 2 }, borderSkipped: 'bottom', borderRadius: 4, barPercentage: 0.75 });
  state.charts.push(new Chart($('#c-month'), {
    type: 'bar',
    data: {
      labels: months.map((m) => new Date(m.month + '-01T00:00:00').toLocaleDateString('en-AU', { month: 'short' })),
      datasets: [bar('Fuel', 'fuel', C.fuel), bar('Service', 'service', C.service), bar('Other', 'expense', C.expense)],
    },
    options: {
      ...base,
      plugins: { legend: { display: true, position: 'top', align: 'start', labels: { boxWidth: 10, boxHeight: 10, useBorderRadius: true, borderRadius: 3 } },
        tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${money.format(ctx.parsed.y)}`, footer: (items) => `Total: ${money.format(items.reduce((s, i) => s + i.parsed.y, 0))}` } } },
      scales: { x: { ...base.scales.x, stacked: true }, y: { ...base.scales.y, stacked: true, ticks: { callback: (v) => money0.format(v) } } },
    },
  }));

  const cats = calc.byCategory(list).filter((c) => c.total > 0);
  $('#cat-box').style.height = Math.max(120, cats.length * 34 + 30) + 'px';
  const catColor = (name) => (name === 'Fuel' ? C.fuel : SERVICE_CATS.includes(name) ? C.service : C.expense);
  state.charts.push(new Chart($('#c-cat'), {
    type: 'bar',
    data: { labels: cats.map((c) => c.category), datasets: [{ data: cats.map((c) => +c.total.toFixed(2)), backgroundColor: cats.map((c) => catColor(c.category)), borderRadius: 4, borderSkipped: 'start', barPercentage: 0.7 }] },
    options: { ...base, indexAxis: 'y', interaction: { mode: 'nearest', axis: 'y', intersect: false },
      plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => money.format(ctx.parsed.x) } } },
      scales: { x: { grid: { color: C.grid }, border: { display: false }, ticks: { callback: (v) => money0.format(v) } }, y: { grid: { display: false }, border: { color: C.grid } } } },
  }));

  const ppl = calc.pricePerLitre(list);
  if (ppl.length) {
    state.charts.push(new Chart($('#c-ppl'), {
      type: 'line',
      data: { labels: ppl.map((p) => shortDate(p.date)), datasets: [{ label: 'c/L', data: ppl.map((p) => +(p.ppl * 100).toFixed(1)), ...line(C.fuel, ppl.length) }] },
      options: { ...base, plugins: { ...base.plugins, tooltip: { callbacks: { label: (ctx) => `${n1.format(ctx.parsed.y)} c/L` } } } },
    }));
  } else $('#c-ppl').parentElement.outerHTML = '<p class="muted small">No fuel entries with litres and cost yet.</p>';
}

function garageHTML() {
  const vs = state.vehicles.map((v) => {
    const count = state.entries.filter((e) => e.vehicleId === v.id).length;
    return `<div class="vehicle"><div><strong>${esc(v.name)}</strong><br>
      <span class="muted small">${[[v.year, v.make, v.model].filter(Boolean).join(' '), v.rego, `${count} entries`].filter(Boolean).map(esc).join(' · ')}</span></div>
      <button class="btn small" data-act="edit-vehicle" data-id="${v.id}">Edit</button></div>`;
  }).join('');
  return `
    <section class="card"><h2>Vehicles</h2>
      ${vs || '<p class="muted">No vehicles yet.</p>'}
      <button class="btn primary wide" style="margin-top:12px" data-act="add-vehicle">Add vehicle</button>
    </section>
    <section class="card stack"><h2 style="margin:0">Your data</h2>
      <p class="muted small" style="margin:0">Download a spreadsheet of the selected vehicle's entries. Handy as a backup or for your accountant.</p>
      <button class="btn" data-act="export" ${state.vehicles.length ? '' : 'disabled'}>Export CSV</button>
      <p class="muted small" style="margin:0">Bring your history across from the My Car app (Settings → Export in My Car, then pick the .xlsx or .csv file here). Importing the same file twice won't double up.</p>
      <label class="btn" style="display:block;text-align:center;color:var(--text);font-size:1rem">Import from My Car<input type="file" id="import-file" accept=".xlsx,.xls,.csv" hidden></label>
    </section>
    ${window.CARLOG_TEST ? `<section class="card stack"><h2 style="margin:0">Test version</h2>
      <p class="muted small" style="margin:0">Everything you enter here is saved in this browser only. Nothing goes to Firebase.</p>
      <div class="row"><button class="btn grow" data-act="test-reset">Reload history</button><button class="btn danger grow" data-act="test-clear">Start empty</button></div>
    </section>` : ''}
    <section class="card stack"><h2 style="margin:0">Account</h2>
      <p class="muted small" style="margin:0">Signed in as ${esc(state.user.email || state.user.displayName || 'you')}</p>
      <button class="btn" data-act="sign-out">Sign out</button>
    </section>
    <p class="muted small" style="text-align:center;margin:0">My Car Log</p>`;
}

// ---------- Sheets (forms) ----------
const sheet = $('#sheet');
const sheetForm = $('#sheet-form');
let sheetSubmit = null;

function openSheet(html, onSubmit) {
  sheetForm.innerHTML = html;
  sheetSubmit = onSubmit;
  sheet.showModal();
}
sheetForm.addEventListener('submit', async (ev) => {
  ev.preventDefault();
  if (ev.submitter?.value === 'cancel') return sheet.close();
  const btn = ev.submitter;
  if (btn) btn.disabled = true;
  try {
    const result = await sheetSubmit?.(ev.submitter?.value);
    if (result !== false) sheet.close();
  } catch (e) {
    console.error(e);
    toast('Could not save: ' + (e.message || e));
  } finally { if (btn) btn.disabled = false; }
});
sheet.addEventListener('click', (ev) => { if (ev.target === sheet) sheet.close(); });

// Two-tap confirm for destructive buttons (works everywhere, unlike confirm()).
function armed(btn, label) {
  if (!btn) return true;
  if (btn.dataset.armed) return true;
  btn.dataset.armed = '1';
  btn.dataset.label = btn.textContent;
  btn.textContent = label;
  setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = btn.dataset.label; } }, 4000);
  return false;
}

function sheetHead(title) {
  return `<div class="sheet-head"><h2>${title}</h2><button class="link" value="cancel" formnovalidate>Cancel</button></div>`;
}

function vehicleForm(v) {
  const isEdit = !!v;
  v = v || {};
  openSheet(`
    ${sheetHead(isEdit ? 'Edit vehicle' : 'Add vehicle')}
    <label>Name<input name="vname" required placeholder="e.g. Work van" value="${esc(v.name)}"></label>
    <div class="grid3">
      <label>Year<input name="year" inputmode="numeric" value="${esc(v.year)}"></label>
      <label>Make<input name="make" value="${esc(v.make)}"></label>
      <label>Model<input name="model" value="${esc(v.model)}"></label>
    </div>
    <div class="grid2">
      <label>Rego<input name="rego" value="${esc(v.rego)}" autocapitalize="characters"></label>
      <label>Fuel<select name="fuel">${['Unleaded 91', 'Unleaded 95', 'Unleaded 98', 'E10', 'Diesel', 'LPG', 'Electric', 'Hybrid']
        .map((f) => `<option ${v.fuel === f ? 'selected' : ''}>${f}</option>`).join('')}</select></label>
    </div>
    <label>Tank size (L, optional)<input name="tank" inputmode="decimal" value="${esc(v.tank)}"></label>
    <button class="btn primary" value="save">Save</button>
    ${isEdit ? '<button class="btn danger" value="delete" formnovalidate>Delete vehicle</button>' : ''}`,
  async (action) => {
    if (action === 'delete') {
      const count = state.entries.filter((e) => e.vehicleId === v.id).length;
      if (!armed(sheetForm.querySelector('button[value=delete]'), `Tap again to delete ${count} entries`)) return false;
      deleteVehicle(v.id).catch((err) => toast('Sync problem: ' + err.message));
      toast('Vehicle deleted');
      return;
    }
    const f = sheetForm;
    saveVehicle({
      name: f.vname.value.trim(), year: f.year.value.trim(), make: f.make.value.trim(), model: f.model.value.trim(),
      rego: f.rego.value.trim().toUpperCase(), fuel: f.fuel.value, tank: numOrNull(f.tank.value),
    }, v.id).catch((err) => toast('Sync problem: ' + err.message));
    if (!isEdit) render();
    toast(isEdit ? 'Vehicle updated' : 'Vehicle added');
  });
}

function entryForm(entry) {
  const isEdit = !!entry;
  const e = entry || { type: store.get('carlog.lastType') || 'fuel', date: today(), fullTank: true };
  let type = e.type;
  let receipt; // undefined = unchanged
  const all = vehicleEntries();

  const fields = () => {
    const cats = type === 'service' ? SERVICE_CATS : EXPENSE_CATS;
    const catVal = e.type === type ? e.category : cats[0];
    return `
      <div class="grid2">
        <label>Date<input type="date" name="date" required value="${esc(e.date)}"></label>
        <label>Odometer (km)<input name="odo" inputmode="numeric" ${type === 'fuel' ? 'required' : ''} value="${esc(e.odo)}"></label>
      </div>
      <p class="hint" id="odo-hint"></p>
      ${type === 'fuel' ? `
        <div class="grid3">
          <label>Litres<input name="litres" inputmode="decimal" required value="${esc(e.litres)}"></label>
          <label>c/L<input name="cpl" inputmode="decimal" value="${e.litres > 0 && e.cost > 0 ? ((e.cost / e.litres) * 100).toFixed(1) : ''}"></label>
          <label>Total $<input name="cost" inputmode="decimal" required value="${esc(e.cost)}"></label>
        </div>
        <p class="hint">Fill in any two and the third is worked out.</p>
        <label class="check"><input type="checkbox" name="fullTank" ${e.fullTank !== false ? 'checked' : ''}>Filled the tank to full</label>
        <label class="check"><input type="checkbox" name="missed" ${e.missed ? 'checked' : ''}>I missed logging the fill-up before this one</label>
        <label>Servo<input name="place" value="${esc(e.place)}" placeholder="optional"></label>`
      : `
        <div class="grid2">
          <label>Category<select name="category">${cats.map((c) => `<option ${catVal === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
          <label>Cost $<input name="cost" inputmode="decimal" required value="${esc(e.cost)}"></label>
        </div>
        <label>${type === 'service' ? 'Workshop' : 'Where'}<input name="place" value="${esc(e.place)}" placeholder="optional"></label>`}
      <label>Notes<textarea name="notes">${esc(e.notes)}</textarea></label>
      <div class="receipt" id="receipt-row">
        <span id="receipt-thumb"></span>
        <label class="btn small" style="display:inline-block">📷 ${e.hasReceipt ? 'Replace' : 'Add'} receipt<input type="file" name="receipt" accept="image/*" hidden></label>
        ${e.hasReceipt ? '<button type="button" class="link" id="receipt-view">View</button><button type="button" class="link" id="receipt-remove" style="color:var(--danger)">Remove</button>' : ''}
      </div>
      <button class="btn primary" value="save">Save</button>
      ${isEdit ? '<button class="btn danger" value="delete" formnovalidate>Delete entry</button>' : ''}`;
  };

  const seg = () => isEdit ? '' : `<div class="seg">${['fuel', 'service', 'expense'].map((t) =>
    `<button type="button" data-type="${t}" class="${t === type ? 'on' : ''}">${TYPE_LABEL[t]}</button>`).join('')}</div>`;

  const draw = () => {
    // Keep values typed so far when switching type
    const f = sheetForm;
    if (f.date) { e.date = f.date.value; e.odo = f.odo.value; e.cost = f.cost?.value; e.notes = f.notes?.value; e.place = f.place?.value; }
    sheetForm.innerHTML = `${sheetHead(isEdit ? 'Edit ' + TYPE_LABEL[type].toLowerCase() : 'New entry')}${seg()}${fields()}`;
    wire();
  };

  const wire = () => {
    const f = sheetForm;
    sheetForm.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => { type = b.dataset.type; draw(); }));
    const odoCheck = () => {
      const hint = $('#odo-hint');
      const prev = calc.maxOdoBefore(all, f.date.value, e.id);
      const o = numOrNull(f.odo.value);
      if (o !== null && prev !== null && o < prev) { hint.textContent = `Lower than an earlier reading (${n0.format(prev)} km). Double-check it.`; hint.className = 'hint warn'; }
      else if (prev !== null) { hint.textContent = `Last reading: ${n0.format(prev)} km`; hint.className = 'hint'; }
      else hint.textContent = '';
    };
    f.odo.addEventListener('input', odoCheck);
    f.date.addEventListener('change', odoCheck);
    odoCheck();
    if (type === 'fuel') {
      const order = [];
      const recalc = (changed) => {
        const i = order.indexOf(changed); if (i > -1) order.splice(i, 1); order.push(changed);
        const L = numOrNull(f.litres.value), cpl = numOrNull(f.cpl.value), cost = numOrNull(f.cost.value);
        const lastTwo = order.slice(-2);
        if (!lastTwo.includes('cpl') && L > 0 && cost > 0) f.cpl.value = ((cost / L) * 100).toFixed(1);
        else if (!lastTwo.includes('cost') && L > 0 && cpl > 0) f.cost.value = ((L * cpl) / 100).toFixed(2);
        else if (!lastTwo.includes('litres') && cost > 0 && cpl > 0) f.litres.value = (cost / (cpl / 100)).toFixed(2);
      };
      ['litres', 'cpl', 'cost'].forEach((n) => f[n].addEventListener('input', () => recalc(n)));
    }
    f.receipt.addEventListener('change', async () => {
      const file = f.receipt.files[0];
      if (!file) return;
      try {
        receipt = await compressImage(file);
        $('#receipt-thumb').innerHTML = `<img src="${receipt}" alt="Receipt">`;
      } catch { toast('Could not read that photo'); }
    });
    $('#receipt-remove')?.addEventListener('click', () => { receipt = null; $('#receipt-row').innerHTML = '<span class="muted small">Receipt will be removed when you save.</span>'; });
    $('#receipt-view')?.addEventListener('click', async () => {
      const snap = await getDoc(userDoc('receipts', e.id));
      if (snap.exists() && !$('.receipt-full')) $('#receipt-row').insertAdjacentHTML('afterend', `<img class="receipt-full" src="${snap.data().image}" alt="Receipt">`);
    });
  };

  openSheet('', async (action) => {
    if (action === 'delete') {
      if (!armed(sheetForm.querySelector('button[value=delete]'), 'Tap again to delete')) return false;
      deleteEntry(e.id).catch((err) => toast('Sync problem: ' + err.message));
      toast('Entry deleted');
      return;
    }
    const f = sheetForm;
    const data = {
      vehicleId: e.vehicleId || state.vehicleId, type, date: f.date.value,
      odo: numOrNull(f.odo.value), cost: numOrNull(f.cost.value),
      place: f.place.value.trim(), notes: f.notes.value.trim(),
    };
    if (type === 'fuel') Object.assign(data, { litres: numOrNull(f.litres.value), fullTank: f.fullTank.checked, missed: f.missed.checked });
    else data.category = f.category.value;
    // Close straight away: Firestore saves locally first and syncs when online.
    sheet.close();
    store.set('carlog.lastType', type);
    saveEntry(data, e.id, receipt).catch((err) => toast('Sync problem: ' + err.message));
    toast(isEdit ? 'Entry updated' : 'Saved');
  });
  draw();
}

// ---------- Import ----------
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = Object.assign(document.createElement('script'), { src, onload: res, onerror: () => rej(new Error('Could not load ' + src)) });
    document.head.append(s);
  });
}

async function importFile(file) {
  if (!window.XLSX) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { raw: true, defval: null });
  const parsed = parseMyCar(rows);
  if (!parsed.entries.length) return toast('No entries found in that file');
  const existing = new Set(state.entries.map((e) => e.id));
  const counts = {};
  for (const e of parsed.entries) {
    const c = (counts[e.vehicleName] ||= { total: 0, fuel: 0, service: 0, expense: 0, already: 0 });
    c.total++; c[e.type]++; if (existing.has(e.importId)) c.already++;
  }
  const optionsFor = (name) => {
    const match = state.vehicles.find((v) => v.name.trim().toLowerCase() === name.toLowerCase());
    return `<option value="__new">Create “${esc(name)}”</option>` +
      state.vehicles.map((v) => `<option value="${v.id}" ${match?.id === v.id ? 'selected' : ''}>Add to ${esc(v.name)}</option>`).join('');
  };
  // Already-imported rows keep any edits you've made; only blank litres/servo get filled in.
  const fresh = parsed.entries.filter((e) => !existing.has(e.importId));
  const byId = new Map(state.entries.map((e) => [e.id, e]));
  const fills = parsed.entries.filter((e) => {
    const cur = byId.get(e.importId);
    return cur && ((cur.litres == null && e.litres != null) || (!cur.place && e.place));
  });
  if (!fresh.length && !fills.length) return toast('Everything in that file is already imported');
  const anyNoLitres = fresh.some((e) => e.type === 'fuel' && e.litres == null);
  openSheet(`
    ${sheetHead('Import from My Car')}
    ${parsed.vehicles.map((name, i) => {
      const c = counts[name];
      return `<div class="card stack" style="padding:12px">
        <strong>${esc(name)}</strong>
        <span class="muted small">${c.total} entries: ${c.fuel} fuel, ${c.service} service, ${c.expense} other${c.already ? ` · ${c.already} already imported` : ''}</span>
        ${c.total > c.already ? `<select name="map${i}">${optionsFor(name)}</select>` : ''}
      </div>`;
    }).join('')}
    ${anyNoLitres ? '<p class="hint">My Car\'s export doesn\'t include litres, so imported fill-ups count towards spending and cost per km, but not fuel economy. Economy starts from your next fill-up logged here.</p>' : ''}
    ${parsed.skipped.length ? `<p class="hint warn">${parsed.skipped.length} rows skipped (no date or amount).</p>` : ''}
    ${fills.length ? `<p class="hint">${fills.length} entries you've already imported will get their missing litres and servo filled in.</p>` : ''}
    <button class="btn primary" value="save">${fresh.length ? `Import ${fresh.length} entries` : `Update ${fills.length} entries`}</button>`,
  async () => {
    const f = sheetForm;
    const idFor = {};
    parsed.vehicles.forEach((name, i) => {
      if (!f[`map${i}`]) return; // nothing new for this vehicle
      let id = f[`map${i}`].value;
      if (id === '__new') {
        const ref = doc(userCol('vehicles'));
        setDoc(ref, { name, year: '', make: '', model: '', rego: '', fuel: 'Diesel', tank: null, createdAt: serverTimestamp() });
        id = ref.id;
      }
      idFor[name] = id;
    });
    if (idFor[parsed.vehicles[0]]) {
      state.vehicleId = idFor[parsed.vehicles[0]];
      store.set('carlog.vehicle', state.vehicleId);
    }
    const writes = [];
    for (let i = 0; i < fresh.length; i += 400) {
      const b = writeBatch(db);
      for (const { importId, vehicleName, ...e } of fresh.slice(i, i + 400)) {
        b.set(userDoc('entries', importId), { ...e, vehicleId: idFor[vehicleName], createdAt: serverTimestamp() });
      }
      writes.push(b.commit());
    }
    for (let i = 0; i < fills.length; i += 400) {
      const b = writeBatch(db);
      for (const e of fills.slice(i, i + 400)) {
        const cur = byId.get(e.importId), patch = {};
        if (cur.litres == null && e.litres != null) Object.assign(patch, { litres: e.litres, fullTank: e.fullTank, missed: e.missed });
        if (!cur.place && e.place) patch.place = e.place;
        b.update(userDoc('entries', e.importId), patch);
      }
      writes.push(b.commit());
    }
    Promise.all(writes).catch((err) => toast('Sync problem: ' + err.message));
    toast(fresh.length ? `Imported ${fresh.length} entries` : `Updated ${fills.length} entries`);
    state.view = 'home';
  });
}

// ---------- Events ----------
$('#main').addEventListener('change', (ev) => {
  if (ev.target.id !== 'import-file' || !ev.target.files[0]) return;
  importFile(ev.target.files[0]).catch((err) => { console.error(err); toast('Could not read that file: ' + err.message); });
  ev.target.value = '';
});
$('#vehicle-select').addEventListener('change', (ev) => {
  state.vehicleId = ev.target.value;
  store.set('carlog.vehicle', state.vehicleId);
  render();
});
$('.tabs').addEventListener('click', (ev) => {
  const b = ev.target.closest('button[data-view]');
  if (!b) return;
  state.view = b.dataset.view;
  render();
  scrollTo(0, 0);
});
$('#fab').addEventListener('click', () => entryForm());
$('#main').addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  if (act === 'add-vehicle') vehicleForm();
  else if (act === 'edit-vehicle') vehicleForm(state.vehicles.find((v) => v.id === el.dataset.id));
  else if (act === 'edit-entry') entryForm(state.entries.find((x) => x.id === el.dataset.id));
  else if (act === 'go-log') { state.view = 'log'; render(); }
  else if (act === 'filter') { state.logFilter = el.dataset.f; render(); }
  else if (act === 'sign-out') { if (armed(el, 'Tap again to sign out')) signOut(auth); }
  else if (act === 'test-reset' || act === 'test-clear') {
    if (armed(el, 'Tap again to confirm')) window.CARLOG_TEST[act === 'test-reset' ? 'reset' : 'clear']();
  }
  else if (act === 'export') {
    if (window.CARLOG_TEST) return toast('Downloads are blocked in the test version. Export works in the real app.');
    const v = currentVehicle();
    const blob = new Blob([calc.toCSV(v.name, vehicleEntries())], { type: 'text/csv' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${v.name.replace(/[^\w-]+/g, '_')}_carlog_${today()}.csv` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => state.view === 'charts' && render());
addEventListener('online', () => $('#sync-dot').classList.remove('offline'));
addEventListener('offline', () => $('#sync-dot').classList.add('offline'));

if ('serviceWorker' in navigator && !window.CARLOG_TEST) navigator.serviceWorker.register('sw.js').catch(() => {});
