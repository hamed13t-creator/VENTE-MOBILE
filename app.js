// VenteMobile — gestion des bons de vente, clients et fournisseurs (PWA + Firebase)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, onSnapshot, query, where, orderBy, limit, writeBatch,
  increment, Timestamp, arrayUnion, getDoc
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './config.js';

const $main = document.getElementById('main');
const $nav = document.getElementById('nav');

if (!firebaseConfig.apiKey) {
  $main.innerHTML = `<div class="card"><h2>Configuration requise</h2>
    <p>Ouvrez le fichier <b>config.js</b> et collez-y la configuration de votre projet Firebase.</p></div>`;
  throw new Error('config.js vide');
}

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = initializeFirestore(fbApp, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

// ---------- État global ----------
const S = { user: null, me: {}, settings: {}, products: [], clients: [], suppliers: [] };
let globalSubs = [], viewSubs = [], current = {};

// ---------- Utilitaires ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r2 = n => Math.round((+n || 0) * 100) / 100;
const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.').replace(/\s/g, '')); return isNaN(n) ? 0 : n; };
const fmt = n => r2(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/[  ]/g, ' ');
const fq = n => (Math.round((+n || 0) * 1000) / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 3 }).replace(/[  ]/g, ' ');
const toDate = t => t?.toDate ? t.toDate() : (t instanceof Date ? t : (t ? new Date(t) : null));
const p2 = n => String(n).padStart(2, '0');
const fd = t => { const d = toDate(t); return d ? `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}` : ''; };
const fdt = t => { const d = toDate(t); return d ? `${fd(d)} ${p2(d.getHours())}:${p2(d.getMinutes())}` : ''; };
const isoDay = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const parseDay = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const byName = (a, b) => (a.name || '').localeCompare(b.name || '', 'fr');
const unitShort = u => u === 'kg' ? 'kg' : 'pc';
const now = () => Timestamp.now();
const meName = () => S.me.name || (S.user?.email || '').split('@')[0];
const clientById = id => S.clients.find(c => c.id === id);
const supplierById = id => S.suppliers.find(c => c.id === id);
const sortByDateDesc = (a, b) => (toDate(b.createdAt) || 0) - (toDate(a.createdAt) || 0);

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 2500);
}
// Les écritures ne sont pas attendues : elles sont enregistrées tout de suite en local
// et envoyées au serveur dès qu'Internet est disponible.
function commit(batch, okMsg) {
  batch.commit().catch(e => alert('Erreur d\'enregistrement : ' + e.message));
  toast(okMsg + (navigator.onLine ? '' : ' (hors ligne, sera synchronisé)'));
}
function nextNumber(field, prefixLetter, batch) {
  const n = (S.me[field] || 0) + 1;
  batch.set(doc(db, 'users', S.user.uid), { [field]: n }, { merge: true });
  S.me[field] = n;
  const prefix = (S.me.prefix || 'A') + (prefixLetter || '');
  return `${prefix}-${String(n).padStart(4, '0')}`;
}
function updateNet() {
  const el = document.getElementById('net');
  el.textContent = navigator.onLine ? '' : 'Hors ligne';
  el.className = 'net' + (navigator.onLine ? '' : ' off');
}
addEventListener('online', updateNet); addEventListener('offline', updateNet); updateNet();

// ---------- Impression (ESC/POS via RawBT) ----------
const W = () => +(S.settings.width || 32);
function lr(l, r, w = W()) {
  l = String(l); r = String(r);
  const max = w - r.length - 1;
  if (l.length > max) l = l.slice(0, Math.max(0, max));
  return l + ' '.repeat(Math.max(1, w - l.length - r.length)) + r;
}
function wrap(s, w = W()) {
  const out = []; let line = '';
  for (const word of String(s ?? '').split(/\s+/)) {
    if (!word) continue;
    if ((line ? line + ' ' + word : word).length > w) {
      if (line) out.push(line);
      line = word;
      while (line.length > w) { out.push(line.slice(0, w)); line = line.slice(w); }
    } else line = line ? line + ' ' + word : word;
  }
  if (line) out.push(line);
  return out.length ? out : [''];
}
const sep = () => ({ t: '-'.repeat(W()) });

function tHeader() {
  const st = S.settings, L = [];
  if (st.companyName) wrap(st.companyName, Math.floor(W() / 2)).forEach(t => L.push({ t, a: 'c', b: true, big: true }));
  (st.header || '').split('\n').filter(x => x.trim()).forEach(x => wrap(x).forEach(t => L.push({ t, a: 'c' })));
  L.push(sep());
  return L;
}
function tFooter(L) {
  const f = (S.settings.footer || '').split('\n').filter(x => x.trim());
  if (f.length) { L.push(sep()); f.forEach(x => wrap(x).forEach(t => L.push({ t, a: 'c' }))); }
  return L;
}
function bonTicket(s) {
  const L = tHeader();
  L.push({ t: 'BON DE VENTE N° ' + s.number, b: true });
  L.push({ t: 'Date : ' + fdt(s.createdAt) });
  L.push({ t: 'Client : ' + s.clientName });
  L.push({ t: 'Vendeur : ' + s.createdByName });
  if (s.status === 'modified') L.push({ t: 'Modifié le ' + fdt(s.modifiedAt) });
  if (s.status === 'cancelled') L.push({ t: '*** BON ANNULÉ ***', a: 'c', b: true });
  L.push(sep());
  for (const it of s.items) {
    wrap(it.name).forEach(t => L.push({ t }));
    L.push({ t: lr(`  ${fq(it.qty)} ${unitShort(it.unit)} x ${fmt(it.price)}`, fmt(it.total)) });
  }
  L.push(sep());
  L.push({ t: lr('TOTAL BON', fmt(s.total)), b: true });
  L.push({ t: lr('Ancien solde', fmt(s.prevBalance)) });
  L.push({ t: lr('Versement', fmt(s.paid)) });
  L.push({ t: lr('NOUVEAU SOLDE', fmt(s.newBalance)), b: true });
  return tFooter(L);
}
function recuTicket(p) {
  const L = tHeader();
  L.push({ t: 'REÇU DE VERSEMENT N° ' + p.number, b: true });
  L.push({ t: 'Date : ' + fdt(p.createdAt) });
  L.push({ t: 'Client : ' + p.clientName });
  L.push({ t: 'Vendeur : ' + p.createdByName });
  if (p.status === 'cancelled') L.push({ t: '*** REÇU ANNULÉ ***', a: 'c', b: true });
  if (p.note) wrap('Note : ' + p.note).forEach(t => L.push({ t }));
  L.push(sep());
  L.push({ t: lr('Ancien solde', fmt(p.prevBalance)) });
  L.push({ t: lr('MONTANT VERSÉ', fmt(p.amount)), b: true });
  L.push({ t: lr('NOUVEAU SOLDE', fmt(p.newBalance)), b: true });
  return tFooter(L);
}
function ticketText(L) {
  const w = W();
  return L.map(l => {
    const t = l.big ? l.t.split('').join(' ') : l.t; // aperçu : le gros texte prend 2 colonnes
    if (l.a !== 'c') return t;
    return ' '.repeat(Math.max(0, Math.floor((w - t.length) / 2))) + t;
  }).join('\n');
}
// Tables de caractères : lettres accentuées en PC437/PC850/PC858
const CP_LOWER = { 'é': 0x82, 'è': 0x8A, 'ê': 0x88, 'ë': 0x89, 'à': 0x85, 'â': 0x83, 'ä': 0x84, 'ç': 0x87, 'ù': 0x97, 'û': 0x96, 'ü': 0x81, 'ô': 0x93, 'ö': 0x94, 'î': 0x8C, 'ï': 0x8B, 'É': 0x90, 'Ç': 0x80, '°': 0xF8 };
const CP850_UP = { 'À': 0xB7, 'Â': 0xB6, 'È': 0xD4, 'Ê': 0xD2, 'Ë': 0xD3, 'Î': 0xD7, 'Ï': 0xD8, 'Ô': 0xE2, 'Ù': 0xEB, 'Û': 0xEA };
const strip = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/°/g, 'o');
function encodeText(s, cp) {
  const out = [];
  for (const ch of String(s)) {
    const c = ch.charCodeAt(0);
    if (c < 128) { out.push(c); continue; }
    if (cp !== 'none') {
      if (CP_LOWER[ch] !== undefined) { out.push(CP_LOWER[ch]); continue; }
      if (cp !== '0' && CP850_UP[ch] !== undefined) { out.push(CP850_UP[ch]); continue; }
    }
    for (const x of strip(ch)) out.push(x.charCodeAt(0) < 128 ? x.charCodeAt(0) : 0x3F);
  }
  return out;
}
function escpos(L) {
  const cp = S.settings.codepage || 'none';
  const out = [0x1B, 0x40];
  if (cp !== 'none') out.push(0x1B, 0x74, +cp);
  for (const l of L) {
    out.push(0x1B, 0x61, l.a === 'c' ? 1 : 0, 0x1B, 0x45, l.b ? 1 : 0, 0x1D, 0x21, l.big ? 0x11 : 0);
    out.push(...encodeText(l.t, cp), 0x0A);
  }
  out.push(0x1B, 0x45, 0, 0x1D, 0x21, 0, 0x1B, 0x61, 0);
  for (let i = 0; i < (+S.settings.feed || 3); i++) out.push(0x0A);
  return new Uint8Array(out);
}
function printTicket(L) {
  const bytes = escpos(L);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 4096) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 4096));
  location.href = 'intent:base64,' + btoa(bin) + '#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;';
}

// ---------- Connexion ----------
onAuthStateChanged(auth, user => {
  globalSubs.forEach(u => u()); globalSubs = [];
  S.user = user;
  if (!user) { $nav.hidden = true; return viewLogin(); }
  $nav.hidden = false;
  const refresh = () => current.onState && current.onState();
  globalSubs.push(onSnapshot(doc(db, 'settings', 'general'), s => { S.settings = s.data() || {}; refresh(); }));
  globalSubs.push(onSnapshot(doc(db, 'users', user.uid), s => {
    if (!s.exists() && !s.metadata.fromCache) {
      const name = user.email.split('@')[0];
      const b = writeBatch(db);
      b.set(doc(db, 'users', user.uid), { name, prefix: name.charAt(0).toUpperCase(), email: user.email }, { merge: true });
      b.commit();
    }
    S.me = s.data() || {}; refresh();
  }));
  for (const [col, key] of [['products', 'products'], ['clients', 'clients'], ['suppliers', 'suppliers']]) {
    globalSubs.push(onSnapshot(collection(db, col), s => {
      S[key] = s.docs.map(d => ({ id: d.id, ...d.data() })).sort(byName); refresh();
    }));
  }
  route();
});

function viewLogin() {
  $main.innerHTML = `<div class="card"><h2>Connexion</h2>
    <label>E-mail</label><input id="em" type="email" autocomplete="username">
    <label>Mot de passe</label><input id="pw" type="password" autocomplete="current-password">
    <div class="actions"><button id="go">Se connecter</button></div>
    <p id="err" class="pos"></p></div>`;
  document.getElementById('go').onclick = () => {
    signInWithEmailAndPassword(auth, document.getElementById('em').value.trim(), document.getElementById('pw').value)
      .catch(e => document.getElementById('err').textContent = 'Échec de connexion : ' + e.code);
  };
}

// ---------- Routeur ----------
const routes = [
  [/^#?\/?$/, viewDash],
  [/^#\/bon\/new(?:\/(.+))?$/, m => viewBonEdit({ clientId: m[1] })],
  [/^#\/bon\/edit\/(.+)$/, m => viewBonEdit({ id: m[1] })],
  [/^#\/bon\/(.+)$/, m => viewBon(m[1])],
  [/^#\/bons$/, viewBons],
  [/^#\/clients$/, () => viewPartyList('client')],
  [/^#\/fournisseurs$/, () => viewPartyList('supplier')],
  [/^#\/client\/form(?:\/(.+))?$/, m => viewPartyForm('client', m[1])],
  [/^#\/fournisseur\/form(?:\/(.+))?$/, m => viewPartyForm('supplier', m[1])],
  [/^#\/client\/(.+)$/, m => viewClient(m[1])],
  [/^#\/fournisseur\/(.+)$/, m => viewSupplier(m[1])],
  [/^#\/versement\/c\/(.+)$/, m => viewClientPayment(m[1])],
  [/^#\/versement\/f\/(.+)$/, m => viewSupplierPayment(m[1])],
  [/^#\/recu\/(.+)$/, m => viewRecu(m[1])],
  [/^#\/achat\/new\/(.+)$/, m => viewPurchase({ supplierId: m[1] })],
  [/^#\/achat\/(.+)$/, m => viewPurchase({ id: m[1] })],
  [/^#\/produits$/, viewProducts],
  [/^#\/plus$/, viewMore],
  [/^#\/config$/, viewConfig],
];
function route() {
  if (!S.user) return;
  viewSubs.forEach(u => u()); viewSubs = []; current = {};
  const h = location.hash || '#/';
  document.querySelectorAll('nav a').forEach(a => {
    const href = a.getAttribute('href');
    a.classList.toggle('on', href === '#/' ? (h === '#/' || h === '') : h.startsWith(href));
  });
  window.scrollTo(0, 0);
  for (const [re, fn] of routes) { const m = h.match(re); if (m) return fn(m); }
  viewDash();
}
addEventListener('hashchange', route);
const go = h => { location.hash = h; };
const el = id => document.getElementById(id);

// ---------- Tableau de bord ----------
function periodRange(p, from, to) {
  const n = new Date();
  let a = new Date(n.getFullYear(), n.getMonth(), n.getDate());
  let b = new Date(a); b.setDate(b.getDate() + 1);
  if (p === 'week') a.setDate(a.getDate() - a.getDay());
  if (p === 'month') { a = new Date(n.getFullYear(), n.getMonth(), 1); b = new Date(n.getFullYear(), n.getMonth() + 1, 1); }
  if (p === 'year') { a = new Date(n.getFullYear(), 0, 1); b = new Date(n.getFullYear() + 1, 0, 1); }
  if (p === 'custom' && from && to) { a = parseDay(from); b = parseDay(to); b.setDate(b.getDate() + 1); }
  return [a, b];
}
let dashPeriod = 'day', dashFrom = isoDay(new Date()), dashTo = isoDay(new Date());
function viewDash() {
  let sales = [], pays = [], purch = [];
  const subscribe = () => {
    viewSubs.forEach(u => u()); viewSubs = [];
    const [a, b] = periodRange(dashPeriod, dashFrom, dashTo);
    const ta = Timestamp.fromDate(a), tb = Timestamp.fromDate(b);
    viewSubs.push(onSnapshot(query(collection(db, 'sales'), where('createdAt', '>=', ta), where('createdAt', '<', tb)),
      s => { sales = s.docs.map(d => d.data()).filter(x => x.status !== 'cancelled'); draw(); }));
    viewSubs.push(onSnapshot(query(collection(db, 'clientPayments'), where('createdAt', '>=', ta), where('createdAt', '<', tb)),
      s => { pays = s.docs.map(d => d.data()).filter(x => x.status !== 'cancelled'); draw(); }));
    const ea = new Date(b); ea.setDate(ea.getDate() - 1);
    viewSubs.push(onSnapshot(query(collection(db, 'purchases'), where('invoiceDate', '>=', isoDay(a)), where('invoiceDate', '<=', isoDay(ea))),
      s => { purch = s.docs.map(d => d.data()).filter(x => x.status !== 'cancelled'); draw(); }));
  };
  const draw = () => {
    const tot = sales.reduce((s, x) => s + x.total, 0);
    const enc = sales.reduce((s, x) => s + (x.paid || 0), 0) + pays.reduce((s, x) => s + x.amount, 0);
    const ach = purch.reduce((s, x) => s + x.amount, 0);
    const cre = S.clients.reduce((s, x) => s + (x.balance || 0), 0);
    const dette = S.suppliers.reduce((s, x) => s + (x.balance || 0), 0);
    const bySeller = {};
    sales.forEach(x => { bySeller[x.createdByName] = (bySeller[x.createdByName] || 0) + x.total; });
    const P = { day: 'Jour', week: 'Semaine', month: 'Mois', year: 'Année', custom: 'Période' };
    $main.innerHTML = `
      <div class="tabs">${Object.entries(P).map(([k, v]) => `<button data-p="${k}" class="${k === dashPeriod ? 'on' : ''}">${v}</button>`).join('')}</div>
      ${dashPeriod === 'custom' ? `<div class="row"><input type="date" id="df" value="${dashFrom}"><input type="date" id="dt" value="${dashTo}"></div><br>` : ''}
      <div class="grid2">
        <div class="stat"><div class="l">Ventes (${sales.length} bons)</div><div class="v">${fmt(tot)}</div></div>
        <div class="stat"><div class="l">Encaissé</div><div class="v neg">${fmt(enc)}</div></div>
        <div class="stat"><div class="l">Achats fournisseurs</div><div class="v">${fmt(ach)}</div></div>
        <div class="stat"><div class="l">Versements reçus (hors bons)</div><div class="v">${fmt(pays.reduce((s, x) => s + x.amount, 0))}</div></div>
      </div>
      <h3>Soldes actuels</h3>
      <div class="grid2">
        <a class="stat" href="#/clients" style="text-decoration:none;color:inherit"><div class="l">Total créances clients</div><div class="v pos">${fmt(cre)}</div></a>
        <a class="stat" href="#/fournisseurs" style="text-decoration:none;color:inherit"><div class="l">Total dû aux fournisseurs</div><div class="v pos">${fmt(dette)}</div></a>
      </div>
      <h3>Ventes par vendeur</h3>
      <div class="list">${Object.entries(bySeller).map(([k, v]) => `<div class="it"><span>${esc(k)}</span><span class="amt">${fmt(v)}</span></div>`).join('') || '<p class="muted">Aucune vente sur la période.</p>'}</div>
      <div class="actions"><a class="btn" href="#/bon/new">+ Nouveau bon</a></div>`;
    $main.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { dashPeriod = b.dataset.p; subscribe(); draw(); });
    if (el('df')) { el('df').onchange = e => { dashFrom = e.target.value; subscribe(); }; el('dt').onchange = e => { dashTo = e.target.value; subscribe(); }; }
  };
  subscribe(); draw();
  current.onState = draw;
}

// ---------- Bon de vente : création / modification ----------
function viewBonEdit({ id, clientId }) {
  let sale = null, items = [], paid = 0, cid = clientId || '', filter = '';
  const load = () => {
    if (!id) return draw();
    getDoc(doc(db, 'sales', id)).then(d => {
      if (!d.exists()) { $main.innerHTML = '<p>Bon introuvable.</p>'; return; }
      sale = { id: d.id, ...d.data() };
      if (sale.status === 'cancelled') { alert('Ce bon est annulé, il ne peut plus être modifié.'); return go('#/bon/' + id); }
      items = sale.items.map(x => ({ ...x })); paid = sale.paid || 0; cid = sale.clientId;
      draw();
    });
  };
  const total = () => r2(items.reduce((s, x) => s + r2(num(x.qty) * num(x.price)), 0));
  const prev = () => sale ? sale.prevBalance : (clientById(cid)?.balance || 0);
  const updTotals = () => {
    items.forEach((x, i) => { const t = $main.querySelector(`[data-tot="${i}"]`); if (t) t.textContent = fmt(num(x.qty) * num(x.price)); });
    el('t-total').textContent = fmt(total());
    el('t-prev').textContent = fmt(prev());
    el('t-new').textContent = fmt(prev() + total() - num(paid));
  };
  const draw = () => {
    const clients = S.clients.filter(c => !filter || c.name.toLowerCase().includes(filter.toLowerCase()));
    $main.innerHTML = `
      <h2>${sale ? 'Modifier le bon ' + esc(sale.number) : 'Nouveau bon de vente'}</h2>
      ${sale ? `<p class="badge mod">La modification sera tracée (ancienne version conservée).</p>` : ''}
      <label>Client</label>
      ${sale ? `<input value="${esc(sale.clientName)}" disabled>` : `
        <input id="cf" placeholder="🔍 Rechercher un client" value="${esc(filter)}">
        <div class="row" style="margin-top:6px"><select id="cs"><option value="">— Choisir un client —</option>
          ${clients.map(c => `<option value="${c.id}" ${c.id === cid ? 'selected' : ''}>${esc(c.name)} (${fmt(c.balance || 0)})</option>`).join('')}
        </select><a class="btn sec" style="flex:0 0 auto" href="#/client/form">+</a></div>`}
      <h3>Articles</h3>
      <div id="lines">${items.map((x, i) => `
        <div class="line">
          <div class="row"><input data-i="${i}" data-f="name" value="${esc(x.name)}" placeholder="Désignation">
            <button class="danger small" style="flex:0 0 auto" data-del="${i}">✕</button></div>
          <div class="row" style="margin-top:6px">
            <input data-i="${i}" data-f="qty" type="number" inputmode="decimal" step="any" value="${x.qty}" placeholder="Qté">
            <select data-i="${i}" data-f="unit"><option value="piece" ${x.unit !== 'kg' ? 'selected' : ''}>pièce</option><option value="kg" ${x.unit === 'kg' ? 'selected' : ''}>kg</option></select>
            <input data-i="${i}" data-f="price" type="number" inputmode="decimal" step="any" value="${x.price}" placeholder="Prix">
          </div>
          <div class="tot" data-tot="${i}">${fmt(num(x.qty) * num(x.price))}</div>
        </div>`).join('') || '<p class="muted">Aucun article.</p>'}</div>
      <div class="row">
        <select id="ps"><option value="">+ Produit de la liste…</option>
          ${S.products.map(p => `<option value="${p.id}">${esc(p.name)} — ${fmt(p.price)} / ${unitShort(p.unit)}</option>`).join('')}</select>
        <button class="sec" style="flex:0 0 auto" id="free">+ Libre</button>
      </div>
      <div class="card totals" style="margin-top:12px">
        <div class="row big"><span>Total bon</span><span id="t-total"></span></div>
        <div class="row"><span>Ancien solde</span><span id="t-prev"></span></div>
        <div class="row"><span>Versement</span><input id="paid" type="number" inputmode="decimal" step="any" value="${paid || ''}" placeholder="0"></div>
        <div class="row big"><span>Nouveau solde</span><span id="t-new" class="pos"></span></div>
      </div>
      <div class="actions"><button id="save">Enregistrer</button><button id="savep">Enregistrer + imprimer</button></div>
      ${sale ? `<div class="actions"><a class="btn sec" href="#/bon/${sale.id}">Annuler la modification</a></div>` : ''}`;
    updTotals();
    if (el('cf')) {
      el('cf').oninput = e => { filter = e.target.value; const pos = e.target.selectionStart; draw(); el('cf').focus(); el('cf').setSelectionRange(pos, pos); };
      el('cs').onchange = e => { cid = e.target.value; updTotals(); };
    }
    $main.querySelectorAll('[data-f]').forEach(inp => {
      const h = e => { items[+inp.dataset.i][inp.dataset.f] = e.target.value; updTotals(); };
      inp.oninput = h; inp.onchange = h;
    });
    $main.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { items.splice(+b.dataset.del, 1); draw(); });
    el('ps').onchange = e => {
      const p = S.products.find(x => x.id === e.target.value); if (!p) return;
      items.push({ productId: p.id, name: p.name, qty: 1, unit: p.unit || 'piece', price: p.price }); draw();
    };
    el('free').onclick = () => { items.push({ productId: null, name: '', qty: 1, unit: 'piece', price: '' }); draw(); $main.querySelector(`[data-i="${items.length - 1}"][data-f="name"]`).focus(); };
    el('paid').oninput = e => { paid = e.target.value; updTotals(); };
    el('save').onclick = () => save(false);
    el('savep').onclick = () => save(true);
  };
  const save = (print) => {
    const clean = items.map(x => ({ productId: x.productId || null, name: String(x.name).trim(), qty: num(x.qty), unit: x.unit === 'kg' ? 'kg' : 'piece', price: num(x.price), total: r2(num(x.qty) * num(x.price)) }))
      .filter(x => x.name || x.qty || x.price);
    if (!cid) return alert('Choisissez un client.');
    if (!clean.length) return alert('Ajoutez au moins un article.');
    if (clean.some(x => !x.name || x.qty <= 0)) return alert('Chaque article doit avoir une désignation et une quantité.');
    const tot = r2(clean.reduce((s, x) => s + x.total, 0)), pd = r2(num(paid));
    const b = writeBatch(db);
    let saleId, data;
    if (!sale) {
      const c = clientById(cid);
      const ref = doc(collection(db, 'sales')); saleId = ref.id;
      data = {
        number: nextNumber('bonCounter', '', b), clientId: cid, clientName: c.name, items: clean, total: tot, paid: pd,
        prevBalance: r2(c.balance || 0), newBalance: r2((c.balance || 0) + tot - pd), status: 'ok',
        createdAt: now(), createdBy: S.user.uid, createdByName: meName(), history: []
      };
      b.set(ref, data);
      b.update(doc(db, 'clients', cid), { balance: increment(r2(tot - pd)) });
    } else {
      const delta = r2((tot - pd) - (sale.total - (sale.paid || 0)));
      const msg = `Confirmer la modification du bon ${sale.number} ?\n\nAncien total : ${fmt(sale.total)} — Nouveau : ${fmt(tot)}\nAncien versement : ${fmt(sale.paid)} — Nouveau : ${fmt(pd)}\nLe solde du client sera ajusté de ${delta >= 0 ? '+' : ''}${fmt(delta)}.`;
      if (!confirm(msg)) return;
      saleId = sale.id;
      const upd = {
        items: clean, total: tot, paid: pd, newBalance: r2(sale.prevBalance + tot - pd), status: 'modified',
        modifiedAt: now(), modifiedByName: meName(),
        history: arrayUnion({ at: now(), byName: meName(), items: sale.items, total: sale.total, paid: sale.paid || 0 })
      };
      b.update(doc(db, 'sales', saleId), upd);
      if (delta) b.update(doc(db, 'clients', cid), { balance: increment(delta) });
      data = { ...sale, ...upd };
    }
    commit(b, 'Bon enregistré');
    go('#/bon/' + saleId);
    if (print) setTimeout(() => printTicket(bonTicket(data)), 400);
  };
  load();
  // Données arrivées après l'affichage : on complète les listes sans perdre la saisie
  current.onState = () => {
    if (sale || !el('ps')) return;
    if ((el('cs') && el('cs').options.length <= 1 && S.clients.length) || (el('ps').options.length <= 1 && S.products.length)) draw();
    else updTotals();
  };
}

// ---------- Bon : consultation ----------
function viewBon(id) {
  viewSubs.push(onSnapshot(doc(db, 'sales', id), d => {
    if (!d.exists()) { $main.innerHTML = '<p>Bon introuvable.</p>'; return; }
    const s = { id: d.id, ...d.data() };
    const st = s.status === 'cancelled' ? '<span class="badge ann">Annulé</span>' : s.status === 'modified' ? '<span class="badge mod">Modifié</span>' : '';
    $main.innerHTML = `
      <h2>Bon ${esc(s.number)} ${st}</h2>
      <p class="muted">Créé le ${fdt(s.createdAt)} par ${esc(s.createdByName)}
        ${s.status === 'modified' ? `<br>Modifié le ${fdt(s.modifiedAt)} par ${esc(s.modifiedByName)}` : ''}
        ${s.status === 'cancelled' ? `<br>Annulé le ${fdt(s.cancelledAt)} par ${esc(s.cancelledByName)}` : ''}</p>
      <pre class="ticket">${esc(ticketText(bonTicket(s)))}</pre>
      <div class="actions">
        <button id="pr">🖨️ Imprimer</button>
        ${s.status !== 'cancelled' ? `<a class="btn sec" href="#/bon/edit/${s.id}">✏️ Modifier</a><button class="danger" id="cancel">Annuler le bon</button>` : ''}
      </div>
      <a class="btn sec" href="#/client/${s.clientId}">Voir le client</a>
      ${(s.history || []).length ? `<h3>Historique des modifications</h3>` + s.history.slice().reverse().map(h => `
        <div class="hist">Version avant modification du ${fdt(h.at)} (par ${esc(h.byName)}) :<br>
          ${h.items.map(i => `${esc(i.name)} : ${fq(i.qty)} ${unitShort(i.unit)} × ${fmt(i.price)} = ${fmt(i.total)}`).join('<br>')}
          <br><b>Total ${fmt(h.total)} — versement ${fmt(h.paid)}</b></div>`).join('') : ''}`;
    el('pr').onclick = () => printTicket(bonTicket(s));
    if (el('cancel')) el('cancel').onclick = () => {
      const amt = r2(s.total - (s.paid || 0));
      if (!confirm(`Annuler définitivement le bon ${s.number} ?\nLe solde du client sera diminué de ${fmt(amt)}.\nLe bon restera visible avec la mention ANNULÉ.`)) return;
      const b = writeBatch(db);
      b.update(doc(db, 'sales', s.id), { status: 'cancelled', cancelledAt: now(), cancelledByName: meName() });
      b.update(doc(db, 'clients', s.clientId), { balance: increment(-amt) });
      commit(b, 'Bon annulé');
    };
  }));
}

// ---------- Liste des bons ----------
function viewBons() {
  let list = [], f = '';
  viewSubs.push(onSnapshot(query(collection(db, 'sales'), orderBy('createdAt', 'desc'), limit(200)), s => {
    list = s.docs.map(d => ({ id: d.id, ...d.data() })); draw();
  }));
  const draw = () => {
    const q = f.toLowerCase();
    const rows = list.filter(s => !q || s.number.toLowerCase().includes(q) || s.clientName.toLowerCase().includes(q));
    $main.innerHTML = `<h2>Bons de vente</h2><input id="f" placeholder="🔍 N° de bon ou client" value="${esc(f)}"><br><br>
      <div class="list">${rows.map(s => `<a href="#/bon/${s.id}" class="${s.status === 'cancelled' ? 'cancelled' : ''}">
        <div><b>${esc(s.number)}</b> ${s.status === 'modified' ? '<span class="badge mod">Modifié</span>' : ''}${s.status === 'cancelled' ? '<span class="badge ann">Annulé</span>' : ''}
          <div class="sub">${esc(s.clientName)} · ${fdt(s.createdAt)} · ${esc(s.createdByName)}</div></div>
        <span class="amt">${fmt(s.total)}</span></a>`).join('') || '<p class="muted">Aucun bon.</p>'}</div>`;
    el('f').oninput = e => { f = e.target.value; const p = e.target.selectionStart; draw(); el('f').focus(); el('f').setSelectionRange(p, p); };
  };
  draw();
}

// ---------- Clients / fournisseurs : listes et fiches ----------
function viewPartyList(kind) {
  let f = '';
  const isC = kind === 'client';
  const draw = () => {
    const all = isC ? S.clients : S.suppliers, q = f.toLowerCase();
    const rows = all.filter(x => !q || x.name.toLowerCase().includes(q) || (x.phone || '').includes(q));
    const tot = all.reduce((s, x) => s + (x.balance || 0), 0);
    $main.innerHTML = `<h2>${isC ? 'Clients' : 'Fournisseurs'}</h2>
      <div class="stat" style="margin-bottom:10px"><div class="l">${isC ? 'Total créances' : 'Total dû'}</div><div class="v pos">${fmt(tot)}</div></div>
      <div class="row"><input id="f" placeholder="🔍 Rechercher" value="${esc(f)}"><a class="btn" style="flex:0 0 auto" href="#/${isC ? 'client' : 'fournisseur'}/form">+ Ajouter</a></div><br>
      <div class="list">${rows.map(x => `<a href="#/${isC ? 'client' : 'fournisseur'}/${x.id}">
        <div>${esc(x.name)}<div class="sub">${esc(x.phone || '')}</div></div>
        <span class="amt ${(x.balance || 0) > 0 ? 'pos' : 'neg'}">${fmt(x.balance || 0)}</span></a>`).join('') || '<p class="muted">Aucun résultat.</p>'}</div>`;
    el('f').oninput = e => { f = e.target.value; const p = e.target.selectionStart; draw(); el('f').focus(); el('f').setSelectionRange(p, p); };
  };
  draw(); current.onState = draw;
}

function viewPartyForm(kind, id) {
  const isC = kind === 'client', col = isC ? 'clients' : 'suppliers';
  const x = id ? (isC ? clientById(id) : supplierById(id)) : null;
  current.onState = null;
  if (id && !x) { $main.innerHTML = '<p class="muted">Chargement…</p>'; current.onState = () => viewPartyForm(kind, id); return; }
  $main.innerHTML = `<h2>${x ? 'Modifier' : 'Nouveau'} ${isC ? 'client' : 'fournisseur'}</h2>
    <label>Nom *</label><input id="n" value="${esc(x?.name || '')}">
    <label>Téléphone</label><input id="t" type="tel" value="${esc(x?.phone || '')}">
    <label>Adresse</label><input id="a" value="${esc(x?.address || '')}">
    <label>Solde de départ ${isC ? '(ce que le client vous doit)' : '(ce que vous devez au fournisseur)'}</label>
    <input id="o" type="number" inputmode="decimal" step="any" value="${x ? (x.openingBalance || 0) : ''}" placeholder="0">
    ${x ? '<p class="muted">Modifier le solde de départ ajuste le solde actuel de la même différence.</p>' : ''}
    <div class="actions"><button id="s">Enregistrer</button><button class="sec" onclick="history.back()">Retour</button></div>`;
  el('s').onclick = () => {
    const name = el('n').value.trim(); if (!name) return alert('Le nom est obligatoire.');
    const ob = r2(num(el('o').value));
    const b = writeBatch(db);
    const data = { name, phone: el('t').value.trim(), address: el('a').value.trim(), openingBalance: ob };
    let ref;
    if (x) {
      ref = doc(db, col, x.id);
      const d = r2(ob - (x.openingBalance || 0));
      if (d && !confirm(`Le solde de départ change de ${fmt(x.openingBalance || 0)} à ${fmt(ob)}.\nLe solde actuel sera ajusté de ${d > 0 ? '+' : ''}${fmt(d)}. Confirmer ?`)) return;
      b.update(ref, { ...data, balance: increment(d), updatedAt: now(), updatedByName: meName() });
    } else {
      ref = doc(collection(db, col));
      b.set(ref, { ...data, balance: ob, createdAt: now(), createdByName: meName() });
    }
    commit(b, 'Enregistré');
    go(`#/${isC ? 'client' : 'fournisseur'}/${ref.id}`);
  };
}

function viewClient(id) {
  let sales = [], pays = [];
  viewSubs.push(onSnapshot(query(collection(db, 'sales'), where('clientId', '==', id)), s => { sales = s.docs.map(d => ({ id: d.id, t: 'sale', ...d.data() })); draw(); }));
  viewSubs.push(onSnapshot(query(collection(db, 'clientPayments'), where('clientId', '==', id)), s => { pays = s.docs.map(d => ({ id: d.id, t: 'pay', ...d.data() })); draw(); }));
  const draw = () => {
    const c = clientById(id);
    if (!c) { $main.innerHTML = '<p class="muted">Chargement…</p>'; return; }
    const rows = [...sales, ...pays].sort(sortByDateDesc);
    $main.innerHTML = `<h2>${esc(c.name)}</h2>
      <p class="muted">${esc(c.phone || '')} ${c.address ? '· ' + esc(c.address) : ''}</p>
      <div class="grid2"><div class="stat"><div class="l">Solde actuel</div><div class="v ${(c.balance || 0) > 0 ? 'pos' : 'neg'}">${fmt(c.balance || 0)}</div></div>
        <div class="stat"><div class="l">Solde de départ</div><div class="v">${fmt(c.openingBalance || 0)}</div></div></div>
      <div class="actions"><a class="btn" href="#/bon/new/${c.id}">🧾 Nouveau bon</a><a class="btn" href="#/versement/c/${c.id}">💰 Versement</a>
        <a class="btn sec" href="#/client/form/${c.id}">✏️ Modifier</a></div>
      <h3>Historique</h3>
      <div class="list">${rows.map(r => r.t === 'sale' ? `
        <a href="#/bon/${r.id}" class="${r.status === 'cancelled' ? 'cancelled' : ''}"><div>🧾 Bon ${esc(r.number)} ${r.status === 'modified' ? '<span class="badge mod">Modifié</span>' : ''}${r.status === 'cancelled' ? '<span class="badge ann">Annulé</span>' : ''}
          <div class="sub">${fdt(r.createdAt)} · ${esc(r.createdByName)}${r.paid ? ' · versé ' + fmt(r.paid) : ''}</div></div>
          <span class="amt pos">+${fmt(r.total)}</span></a>` : `
        <a href="#/recu/${r.id}" class="${r.status === 'cancelled' ? 'cancelled' : ''}"><div>💰 Versement ${esc(r.number || '')} ${r.status === 'cancelled' ? '<span class="badge ann">Annulé</span>' : ''}
          <div class="sub">${fdt(r.createdAt)} · ${esc(r.createdByName)}${r.note ? ' · ' + esc(r.note) : ''}</div></div>
          <span class="amt neg">−${fmt(r.amount)}</span></a>`).join('') || '<p class="muted">Aucune opération.</p>'}
        <div class="it"><div>Solde de départ</div><span class="amt">${fmt(c.openingBalance || 0)}</span></div></div>`;
  };
  draw(); current.onState = draw;
}

function viewSupplier(id) {
  let purch = [], pays = [];
  viewSubs.push(onSnapshot(query(collection(db, 'purchases'), where('supplierId', '==', id)), s => { purch = s.docs.map(d => ({ id: d.id, t: 'buy', ...d.data() })); draw(); }));
  viewSubs.push(onSnapshot(query(collection(db, 'supplierPayments'), where('supplierId', '==', id)), s => { pays = s.docs.map(d => ({ id: d.id, t: 'pay', ...d.data() })); draw(); }));
  const draw = () => {
    const f = supplierById(id);
    if (!f) { $main.innerHTML = '<p class="muted">Chargement…</p>'; return; }
    const key = r => r.t === 'buy' ? (r.invoiceDate || '') + fdt(r.createdAt) : isoDay(toDate(r.createdAt) || new Date()) + fdt(r.createdAt);
    const rows = [...purch, ...pays].sort((a, b) => key(b).localeCompare(key(a)));
    $main.innerHTML = `<h2>${esc(f.name)}</h2>
      <p class="muted">${esc(f.phone || '')} ${f.address ? '· ' + esc(f.address) : ''}</p>
      <div class="grid2"><div class="stat"><div class="l">Solde dû</div><div class="v ${(f.balance || 0) > 0 ? 'pos' : 'neg'}">${fmt(f.balance || 0)}</div></div>
        <div class="stat"><div class="l">Solde de départ</div><div class="v">${fmt(f.openingBalance || 0)}</div></div></div>
      <div class="actions"><a class="btn" href="#/achat/new/${f.id}">📦 Achat</a><a class="btn" href="#/versement/f/${f.id}">💰 Versement</a>
        <a class="btn sec" href="#/fournisseur/form/${f.id}">✏️ Modifier</a></div>
      <h3>Historique</h3>
      <div class="list">${rows.map(r => r.t === 'buy' ? `
        <a href="#/achat/${r.id}" class="${r.status === 'cancelled' ? 'cancelled' : ''}"><div>📦 Achat ${r.invoiceNo ? 'fact. ' + esc(r.invoiceNo) : ''} ${r.status === 'modified' ? '<span class="badge mod">Modifié</span>' : ''}${r.status === 'cancelled' ? '<span class="badge ann">Annulé</span>' : ''}
          <div class="sub">Facture du ${fd(parseDay(r.invoiceDate))} · saisi par ${esc(r.createdByName)}</div></div>
          <span class="amt pos">+${fmt(r.amount)}</span></a>` : `
        <div class="it ${r.status === 'cancelled' ? 'cancelled' : ''}"><div>💰 Versement ${r.status === 'cancelled' ? '<span class="badge ann">Annulé</span>' : ''}
          <div class="sub">${fdt(r.createdAt)} · ${esc(r.createdByName)}${r.note ? ' · ' + esc(r.note) : ''}</div>
          ${r.status !== 'cancelled' ? `<button class="small sec" data-cp="${r.id}">Annuler</button>` : ''}</div>
          <span class="amt neg">−${fmt(r.amount)}</span></div>`).join('') || '<p class="muted">Aucune opération.</p>'}
        <div class="it"><div>Solde de départ</div><span class="amt">${fmt(f.openingBalance || 0)}</span></div></div>`;
    $main.querySelectorAll('[data-cp]').forEach(btn => btn.onclick = () => {
      const p = pays.find(x => x.id === btn.dataset.cp);
      if (!confirm(`Annuler ce versement de ${fmt(p.amount)} ?\nLe solde dû au fournisseur augmentera d'autant.`)) return;
      const b = writeBatch(db);
      b.update(doc(db, 'supplierPayments', p.id), { status: 'cancelled', cancelledAt: now(), cancelledByName: meName() });
      b.update(doc(db, 'suppliers', id), { balance: increment(p.amount) });
      commit(b, 'Versement annulé');
    });
  };
  draw(); current.onState = draw;
}

// ---------- Versements ----------
function viewClientPayment(cid) {
  const draw = () => {
    const c = clientById(cid);
    if (!c) { $main.innerHTML = '<p class="muted">Chargement…</p>'; return; }
    $main.innerHTML = `<h2>Versement client</h2><p><b>${esc(c.name)}</b> — solde actuel <b class="pos">${fmt(c.balance || 0)}</b></p>
      <label>Montant versé *</label><input id="m" type="number" inputmode="decimal" step="any">
      <label>Note</label><input id="n" placeholder="Facultatif">
      <div class="actions"><button id="s">Enregistrer</button><button id="sp">Enregistrer + reçu</button></div>`;
    const save = print => {
      const amt = r2(num(el('m').value)); if (amt <= 0) return alert('Saisissez un montant.');
      const b = writeBatch(db), ref = doc(collection(db, 'clientPayments'));
      const data = { number: nextNumber('recuCounter', 'R', b), clientId: cid, clientName: c.name, amount: amt, note: el('n').value.trim(),
        prevBalance: r2(c.balance || 0), newBalance: r2((c.balance || 0) - amt), status: 'ok', createdAt: now(), createdBy: S.user.uid, createdByName: meName() };
      b.set(ref, data);
      b.update(doc(db, 'clients', cid), { balance: increment(-amt) });
      commit(b, 'Versement enregistré');
      go('#/client/' + cid);
      if (print) setTimeout(() => printTicket(recuTicket(data)), 400);
    };
    el('s').onclick = () => save(false); el('sp').onclick = () => save(true);
  };
  draw(); current.onState = () => { if (!el('m')) draw(); };
}

function viewRecu(id) {
  viewSubs.push(onSnapshot(doc(db, 'clientPayments', id), d => {
    if (!d.exists()) { $main.innerHTML = '<p>Reçu introuvable.</p>'; return; }
    const p = { id: d.id, ...d.data() };
    $main.innerHTML = `<h2>Versement ${esc(p.number || '')} ${p.status === 'cancelled' ? '<span class="badge ann">Annulé</span>' : ''}</h2>
      ${p.status === 'cancelled' ? `<p class="muted">Annulé le ${fdt(p.cancelledAt)} par ${esc(p.cancelledByName)}</p>` : ''}
      <pre class="ticket">${esc(ticketText(recuTicket(p)))}</pre>
      <div class="actions"><button id="pr">🖨️ Imprimer le reçu</button>
        ${p.status !== 'cancelled' ? '<button class="danger" id="cancel">Annuler le versement</button>' : ''}</div>
      <a class="btn sec" href="#/client/${p.clientId}">Voir le client</a>`;
    el('pr').onclick = () => printTicket(recuTicket(p));
    if (el('cancel')) el('cancel').onclick = () => {
      if (!confirm(`Annuler ce versement de ${fmt(p.amount)} ?\nLe solde du client augmentera d'autant.`)) return;
      const b = writeBatch(db);
      b.update(doc(db, 'clientPayments', p.id), { status: 'cancelled', cancelledAt: now(), cancelledByName: meName() });
      b.update(doc(db, 'clients', p.clientId), { balance: increment(p.amount) });
      commit(b, 'Versement annulé');
    };
  }));
}

function viewSupplierPayment(sid) {
  const draw = () => {
    const f = supplierById(sid);
    if (!f) { $main.innerHTML = '<p class="muted">Chargement…</p>'; return; }
    $main.innerHTML = `<h2>Versement fournisseur</h2><p><b>${esc(f.name)}</b> — solde dû <b class="pos">${fmt(f.balance || 0)}</b></p>
      <label>Montant versé *</label><input id="m" type="number" inputmode="decimal" step="any">
      <label>Note</label><input id="n" placeholder="Facultatif">
      <div class="actions"><button id="s">Enregistrer</button></div>`;
    el('s').onclick = () => {
      const amt = r2(num(el('m').value)); if (amt <= 0) return alert('Saisissez un montant.');
      const b = writeBatch(db);
      b.set(doc(collection(db, 'supplierPayments')), { supplierId: sid, supplierName: f.name, amount: amt, note: el('n').value.trim(),
        status: 'ok', createdAt: now(), createdBy: S.user.uid, createdByName: meName() });
      b.update(doc(db, 'suppliers', sid), { balance: increment(-amt) });
      commit(b, 'Versement enregistré');
      go('#/fournisseur/' + sid);
    };
  };
  draw(); current.onState = () => { if (!el('m')) draw(); };
}

// ---------- Achats fournisseurs ----------
function viewPurchase({ id, supplierId }) {
  let p = null;
  const draw = () => {
    const sid = p ? p.supplierId : supplierId, f = supplierById(sid);
    if (!f) { $main.innerHTML = '<p class="muted">Chargement…</p>'; return; }
    const ro = p && p.status === 'cancelled';
    $main.innerHTML = `<h2>${p ? 'Achat' : 'Nouvel achat'} ${p?.status === 'modified' ? '<span class="badge mod">Modifié</span>' : ''}${ro ? '<span class="badge ann">Annulé</span>' : ''}</h2>
      <p><b>${esc(f.name)}</b></p>
      ${p ? `<p class="muted">Saisi le ${fdt(p.createdAt)} par ${esc(p.createdByName)}</p>` : ''}
      <label>Montant de l'achat *</label><input id="m" type="number" inputmode="decimal" step="any" value="${p?.amount ?? ''}" ${ro ? 'disabled' : ''}>
      <label>Date de la facture *</label><input id="d" type="date" value="${p?.invoiceDate || isoDay(new Date())}" ${ro ? 'disabled' : ''}>
      <label>N° de facture</label><input id="no" value="${esc(p?.invoiceNo || '')}" placeholder="Facultatif" ${ro ? 'disabled' : ''}>
      <label>Note</label><input id="n" value="${esc(p?.note || '')}" placeholder="Facultatif" ${ro ? 'disabled' : ''}>
      ${!ro ? `<div class="actions"><button id="s">Enregistrer</button>${p ? '<button class="danger" id="c">Annuler l\'achat</button>' : ''}</div>` : ''}
      <a class="btn sec" href="#/fournisseur/${sid}">Retour au fournisseur</a>
      ${(p?.history || []).length ? '<h3>Historique des modifications</h3>' + p.history.slice().reverse().map(h =>
        `<div class="hist">Avant modification du ${fdt(h.at)} (par ${esc(h.byName)}) : montant ${fmt(h.amount)}, facture du ${fd(parseDay(h.invoiceDate))}${h.invoiceNo ? ' n° ' + esc(h.invoiceNo) : ''}</div>`).join('') : ''}`;
    if (ro) return;
    el('s').onclick = () => {
      const amt = r2(num(el('m').value)), date = el('d').value;
      if (amt <= 0 || !date) return alert('Montant et date sont obligatoires.');
      const data = { amount: amt, invoiceDate: date, invoiceNo: el('no').value.trim(), note: el('n').value.trim() };
      const b = writeBatch(db);
      if (!p) {
        b.set(doc(collection(db, 'purchases')), { ...data, supplierId: sid, supplierName: f.name, status: 'ok', createdAt: now(), createdBy: S.user.uid, createdByName: meName(), history: [] });
        b.update(doc(db, 'suppliers', sid), { balance: increment(amt) });
      } else {
        const d = r2(amt - p.amount);
        if (!confirm(`Confirmer la modification de cet achat ?\nAncien montant : ${fmt(p.amount)} — Nouveau : ${fmt(amt)}${d ? `\nLe solde fournisseur sera ajusté de ${d > 0 ? '+' : ''}${fmt(d)}.` : ''}`)) return;
        b.update(doc(db, 'purchases', p.id), { ...data, status: 'modified', modifiedAt: now(), modifiedByName: meName(),
          history: arrayUnion({ at: now(), byName: meName(), amount: p.amount, invoiceDate: p.invoiceDate, invoiceNo: p.invoiceNo || '', note: p.note || '' }) });
        if (d) b.update(doc(db, 'suppliers', sid), { balance: increment(d) });
      }
      commit(b, 'Achat enregistré');
      go('#/fournisseur/' + sid);
    };
    if (el('c')) el('c').onclick = () => {
      if (!confirm(`Annuler cet achat de ${fmt(p.amount)} ?\nLe solde dû au fournisseur diminuera d'autant. L'achat restera visible avec la mention ANNULÉ.`)) return;
      const b = writeBatch(db);
      b.update(doc(db, 'purchases', p.id), { status: 'cancelled', cancelledAt: now(), cancelledByName: meName() });
      b.update(doc(db, 'suppliers', p.supplierId), { balance: increment(-p.amount) });
      commit(b, 'Achat annulé');
      go('#/fournisseur/' + p.supplierId);
    };
  };
  if (id) getDoc(doc(db, 'purchases', id)).then(d => { if (!d.exists()) { $main.innerHTML = '<p>Achat introuvable.</p>'; return; } p = { id: d.id, ...d.data() }; draw(); });
  else draw();
  current.onState = () => { if (!el('m') && (p || !id)) draw(); };
}

// ---------- Produits ----------
function viewProducts() {
  let editId = null, f = '';
  const draw = () => {
    const e = editId ? S.products.find(p => p.id === editId) : null, q = f.toLowerCase();
    $main.innerHTML = `<h2>Liste des produits</h2>
      <div class="card"><b>${e ? 'Modifier le produit' : 'Ajouter un produit'}</b>
        <label>Nom *</label><input id="n" value="${esc(e?.name || '')}">
        <div class="row"><div><label>Prix de vente *</label><input id="p" type="number" inputmode="decimal" step="any" value="${e?.price ?? ''}"></div>
          <div><label>Unité</label><select id="u"><option value="piece">pièce</option><option value="kg" ${e?.unit === 'kg' ? 'selected' : ''}>kg</option></select></div></div>
        <div class="actions"><button id="s">${e ? 'Enregistrer' : 'Ajouter'}</button>${e ? '<button class="sec" id="x">Annuler</button><button class="danger" id="del">Supprimer</button>' : ''}</div></div>
      <input id="f" placeholder="🔍 Rechercher" value="${esc(f)}"><br><br>
      <div class="list">${S.products.filter(p => !q || p.name.toLowerCase().includes(q)).map(p => `<a href="javascript:void 0" data-e="${p.id}">
        <span>${esc(p.name)}</span><span class="amt">${fmt(p.price)} / ${unitShort(p.unit)}</span></a>`).join('') || '<p class="muted">Aucun produit.</p>'}</div>`;
    el('s').onclick = () => {
      const name = el('n').value.trim(), price = r2(num(el('p').value));
      if (!name) return alert('Le nom est obligatoire.');
      const b = writeBatch(db);
      b.set(e ? doc(db, 'products', e.id) : doc(collection(db, 'products')), { name, price, unit: el('u').value }, { merge: true });
      commit(b, 'Produit enregistré'); editId = null;
    };
    if (e) {
      el('x').onclick = () => { editId = null; draw(); };
      el('del').onclick = () => { if (!confirm(`Supprimer « ${e.name} » de la liste ?\n(Les bons déjà faits ne sont pas touchés.)`)) return; const b = writeBatch(db); b.delete(doc(db, 'products', e.id)); commit(b, 'Produit supprimé'); editId = null; };
    }
    $main.querySelectorAll('[data-e]').forEach(a => a.onclick = () => { editId = a.dataset.e; draw(); scrollTo(0, 0); });
    el('f').oninput = ev => { f = ev.target.value; const pos = ev.target.selectionStart; draw(); el('f').focus(); el('f').setSelectionRange(pos, pos); };
  };
  draw();
  current.onState = () => { if (!editId && !el('n')?.value) draw(); };
}

// ---------- Menu « Plus » et configuration ----------
function viewMore() {
  $main.innerHTML = `<h2>Menu</h2><div class="list">
    <a href="#/bons"><span>🧾 Tous les bons de vente</span><span>›</span></a>
    <a href="#/produits"><span>📋 Liste des produits</span><span>›</span></a>
    <a href="#/config"><span>⚙️ Configuration</span><span>›</span></a>
    <a href="javascript:void 0" id="out"><span>🚪 Déconnexion (${esc(S.user.email)})</span><span></span></a></div>`;
  el('out').onclick = () => { if (confirm('Se déconnecter ?')) signOut(auth); };
}

function viewConfig() {
  const draw = () => {
    const st = S.settings, me = S.me;
    $main.innerHTML = `<h2>Configuration</h2>
      <div class="card"><b>En-tête et pied du bon</b> <span class="muted">(commun à tous)</span>
        <label>Nom de l'entreprise</label><input id="cn" value="${esc(st.companyName || '')}">
        <label>Lignes d'en-tête (adresse, téléphone…) — une par ligne</label><textarea id="hd">${esc(st.header || '')}</textarea>
        <label>Pied du bon</label><textarea id="ft">${esc(st.footer || '')}</textarea>
        <h3>Imprimante</h3>
        <div class="row"><div><label>Caractères par ligne</label><select id="w">
          ${[32, 42, 48].map(n => `<option ${+(st.width || 32) === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
          <div><label>Lignes vides à la fin</label><input id="fe" type="number" value="${st.feed ?? 3}"></div></div>
        <label>Accents (é, è, à…)</label><select id="cp">
          ${[['none', 'Sans accents (le plus sûr)'], ['0', 'Table PC437'], ['2', 'Table PC850'], ['19', 'Table PC858']].map(([v, l]) => `<option value="${v}" ${(st.codepage || 'none') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <div class="actions"><button id="s1">Enregistrer</button><button class="sec" id="test">🖨️ Ticket de test</button></div></div>
      <div class="card"><b>Mon profil</b> <span class="muted">(${esc(S.user.email)})</span>
        <label>Nom du vendeur (imprimé sur les bons)</label><input id="mn" value="${esc(me.name || '')}">
        <label>Préfixe de numérotation (ex. A → bons A-0001, reçus AR-0001)</label><input id="mp" value="${esc(me.prefix || '')}" maxlength="4">
        <p class="muted">Chaque utilisateur doit avoir un préfixe différent. Dernier bon : n° ${me.bonCounter || 0}.</p>
        <div class="actions"><button id="s2">Enregistrer</button></div></div>`;
    const vals = () => ({ companyName: el('cn').value.trim(), header: el('hd').value, footer: el('ft').value, width: +el('w').value, feed: Math.max(0, +el('fe').value || 0), codepage: el('cp').value });
    el('s1').onclick = () => { const b = writeBatch(db); b.set(doc(db, 'settings', 'general'), vals(), { merge: true }); commit(b, 'Configuration enregistrée'); };
    el('test').onclick = () => {
      const keep = S.settings; S.settings = { ...keep, ...vals() };
      const L = tHeader(); L.push({ t: 'TICKET DE TEST', a: 'c', b: true }, { t: 'Accents : é è ê à ç ù ô É' }, { t: lr('Article test', fmt(1234.5)) });
      printTicket(tFooter(L)); S.settings = keep;
    };
    el('s2').onclick = () => {
      const prefix = el('mp').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!prefix) return alert('Le préfixe est obligatoire.');
      const b = writeBatch(db); b.set(doc(db, 'users', S.user.uid), { name: el('mn').value.trim(), prefix }, { merge: true }); commit(b, 'Profil enregistré');
    };
  };
  draw();
}
