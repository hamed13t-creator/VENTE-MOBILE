// VenteMobile — application principale (navigation, écrans)
import {
  configured, auth, db, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  collection, doc, onSnapshot, query, where, orderBy, limit, writeBatch,
  increment, Timestamp, arrayUnion, getDoc, getDocs, serverTimestamp
} from './fb.js';
import {
  S, esc, r2, r3, num, fmt, fq, toDate, fd, fdt, isoDay, parseDay, fday, byName, unitShort,
  meName, isAdmin, clientById, supplierById, ms, match, waPhone, el
} from './util.js';
import { toast, confirmBox, alertBox, picker, sheet, guard, hasModal, closeTopModal } from './ui.js';
import {
  bonTicket, recuTicket, releveTicket, testTicket, ticketText, printTicket, shareTicket,
  connectPrinter, forgetPrinter, printerName, PC, setPC
} from './print.js';
import { exportExcel, exportJSON } from './export.js';

const VERSION = '2.0';
const $main = el('main'), $nav = el('nav');
S.users = [];

// ---------- Thème (par téléphone) ----------
function applyTheme() { document.documentElement.dataset.theme = localStorage.getItem('theme') || 'auto'; }
applyTheme();

if (!configured) {
  $main.innerHTML = `<div class="card"><h2>Configuration requise</h2><p>Ouvrez le fichier <b>config.js</b> et collez-y la configuration de votre projet Firebase.</p></div>`;
  throw new Error('config.js vide');
}

// ---------- Écritures + indicateur de synchronisation ----------
let pending = 0;
function updateSync() {
  const s = el('sync');
  if (!navigator.onLine) { s.textContent = pending ? `⚠ Hors ligne · ${pending}` : '⚠ Hors ligne'; s.className = 'sync off'; }
  else if (pending) { s.textContent = `⏳ ${pending}`; s.className = 'sync wait'; }
  else { s.textContent = '✓'; s.className = 'sync ok'; }
  s.title = pending ? `${pending} opération(s) en attente d'envoi` : 'Tout est synchronisé';
}
addEventListener('online', updateSync); addEventListener('offline', updateSync); updateSync();
el('sync').onclick = () => alertBox(navigator.onLine
  ? (pending ? `${pending} opération(s) en cours d'envoi au serveur.` : 'Toutes les opérations sont enregistrées sur le serveur.')
  : `Pas d'Internet. ${pending ? pending + ' opération(s) sont gardées sur ce téléphone et seront envoyées' : 'Les opérations seront gardées sur ce téléphone et envoyées'} au retour du réseau.\n\nNe désinstallez pas l'application et ne videz pas les données de Chrome en attendant.`, 'Synchronisation');

// Les écritures ne sont pas attendues : enregistrées tout de suite sur le téléphone,
// envoyées au serveur dès que possible.
function commit(b, msg) {
  pending++; updateSync();
  b.commit().then(() => { pending--; updateSync(); }).catch(e => {
    pending--; updateSync();
    alertBox('Opération refusée : ' + (e.code === 'permission-denied' ? 'vous n\'avez pas le droit de faire cette opération (ou votre compte est désactivé).' : e.message), 'Erreur');
  });
  if (msg) toast(msg + (navigator.onLine ? '' : ' (hors ligne, sera synchronisé)'));
}
const now = () => Timestamp.now();
// Journal non modifiable : qui, quand, quoi, avant/après
function logJ(b, action, label, entity, entityId, keys = [], before = null, after = null) {
  b.set(doc(collection(db, 'journal')), {
    at: serverTimestamp(), atDevice: now(), by: S.user.uid, byName: meName(),
    action, label, entity, entityId, keys: [entityId, ...keys].filter(Boolean),
    before: before ?? null, after: after ?? null
  });
}
function nextNumber(field, letter, b) {
  const n = (S.me[field] || 0) + 1;
  b.update(doc(db, 'users', S.user.uid), { [field]: n });
  S.me[field] = n;
  return `${S.me.prefix || 'A'}${letter}-${String(n).padStart(4, '0')}`;
}

// ---------- Navigation (bouton Retour, onglets, quitter) ----------
let depth = 0, pendingTab = null, skipGuard = false, navReady = false, lastHash = '#/';
let viewSubs = [], current = {};
const TABS = ['#/', '#/bon/new', '#/clients', '#/fournisseurs', '#/plus'];
const curHash = () => location.hash || '#/';

function nav(hash, { replace = false } = {}) {
  if (replace) history.replaceState({ d: depth }, '', hash);
  else { depth++; history.pushState({ d: depth }, '', hash); }
  render();
}
async function navTab(hash) {
  if (hash === curHash()) return;
  if (current.dirty?.() && !(await confirmBox('Abandonner les modifications en cours ?', { ok: 'Abandonner', danger: true }))) return;
  current.dirty = null;
  if (depth <= 1) { if (hash === '#/') { history.replaceState({ d: 1 }, '', '#/'); render(); } else nav(hash); return; }
  pendingTab = hash; skipGuard = true;
  history.go(-(depth - 1)); // retour à l'accueil, puis ouverture de l'onglet
}
window.addEventListener('popstate', async e => {
  if (!navReady) return;
  const st = e.state;
  if (hasModal()) { closeTopModal(); history.pushState({ d: depth }, '', lastHash); return; }
  if (pendingTab !== null) {
    const t = pendingTab; pendingTab = null; skipGuard = false; depth = 1;
    if (t === '#/') { history.replaceState({ d: 1 }, '', '#/'); render(); }
    else { depth = 2; history.pushState({ d: 2 }, '', t); render(); }
    return;
  }
  if (!skipGuard && current.dirty?.()) {
    history.pushState({ d: depth }, '', lastHash);
    if (await confirmBox('Abandonner les modifications en cours ?', { ok: 'Abandonner', danger: true })) { skipGuard = true; history.back(); }
    return;
  }
  skipGuard = false;
  if (st?.guard) {
    depth = 0;
    if (await confirmBox('Voulez-vous quitter l\'application ?', { ok: 'Quitter', cancel: 'Rester' })) {
      toast('Appuyez encore sur Retour pour quitter', 3000);
      setTimeout(() => { try { window.close(); } catch (er) {} }, 100);
    } else { depth = 1; history.pushState({ d: 1 }, '', '#/'); }
    return;
  }
  depth = st?.d ?? depth + 1;
  if (!st) history.replaceState({ d: depth }, '', curHash());
  render();
});
// Les liens internes passent par la navigation contrôlée
document.addEventListener('click', e => {
  const a = e.target.closest('a[href^="#/"]');
  if (!a) return;
  e.preventDefault();
  if (a.hasAttribute('data-tab')) navTab(a.getAttribute('href'));
  else nav(a.getAttribute('href'));
});
function initNav() {
  const start = curHash();
  history.replaceState({ guard: true }, '', '#/');
  history.pushState({ d: 1 }, '', '#/'); depth = 1;
  if (start !== '#/' && start !== '#') { depth = 2; history.pushState({ d: 2 }, '', start); }
  navReady = true;
  render();
}

// ---------- Connexion et chargement ----------
let globalSubs = [], dataSubs = [];
const stop = arr => { arr.forEach(u => u()); arr.length = 0; };
const refresh = () => current.onState && current.onState();
function shell(on) { $nav.hidden = !on; }

onAuthStateChanged(auth, user => {
  stop(globalSubs); stop(dataSubs); stop(viewSubs);
  S.user = user; S.me = {};
  if (!user) { shell(false); return viewLogin(); }
  $main.innerHTML = '<p class="muted center">Chargement…</p>';
  globalSubs.push(onSnapshot(doc(db, 'users', user.uid), async s => {
    if (!s.exists()) {
      if (s.metadata.fromCache) { $main.innerHTML = '<p class="muted center">Connexion au serveur…<br>(Internet est nécessaire à la première connexion)</p>'; return; }
      return bootstrapUser(user);
    }
    S.me = s.data();
    if (!S.me.active) { stop(dataSubs); shell(false); return viewPending(); }
    if (!dataSubs.length) startData();
    refresh();
  }, err => { $main.innerHTML = `<p class="pos center">Erreur : ${esc(err.message)}</p>`; }));
});

async function bootstrapUser(user) {
  try {
    const st = await getDoc(doc(db, 'settings', 'general'));
    const name = user.email.split('@')[0];
    const base = { name, email: user.email, prefix: name.charAt(0).toUpperCase(), bonCounter: 0, recuCounter: 0, createdAt: now() };
    const b = writeBatch(db);
    if (!st.exists()) {
      // tout premier utilisateur : il devient administrateur
      b.set(doc(db, 'users', user.uid), { ...base, role: 'admin', active: true });
      b.set(doc(db, 'settings', 'general'), { ownerUid: user.uid, createdAt: now() });
    } else b.set(doc(db, 'users', user.uid), { ...base, role: 'vendeur', active: false });
    await b.commit();
  } catch (e) { $main.innerHTML = `<p class="pos center">Impossible de créer le profil : ${esc(e.message)}</p>`; }
}

function startData() {
  dataSubs.push(onSnapshot(doc(db, 'settings', 'general'), s => { S.settings = s.data() || {}; updateLogo(); refresh(); }));
  for (const c of ['products', 'clients', 'suppliers', 'users']) {
    dataSubs.push(onSnapshot(collection(db, c), s => { S[c] = s.docs.map(d => ({ id: d.id, ...d.data() })).sort(byName); refresh(); updateBadges(); }));
  }
  shell(true);
  if (pinIsSet()) lockScreen(() => navReady ? render() : initNav());
  else navReady ? render() : initNav();
}
function updateLogo() { el('logo').src = S.settings.logo || 'icons/icon-192.png'; }
function updateBadges() {
  const n = isAdmin() ? S.users.filter(u => !u.active).length : 0;
  const a = document.querySelector('nav a[href="#/plus"] span');
  if (a) a.innerHTML = 'Plus' + (n ? ` <b class="dot">${n}</b>` : '');
}

function viewLogin() {
  $main.innerHTML = `<div class="card login"><img src="icons/icon-192.png" alt=""><h2>Vente Mobile</h2>
    <label>E-mail</label><input id="em" type="email" autocomplete="username">
    <label>Mot de passe</label><input id="pw" type="password" autocomplete="current-password">
    <div class="actions"><button id="go">Se connecter</button></div><p id="err" class="pos"></p></div>`;
  guard(el('go'), () => signInWithEmailAndPassword(auth, el('em').value.trim(), el('pw').value)
    .catch(e => el('err').textContent = e.code === 'auth/network-request-failed' ? 'Pas d\'Internet.' : 'E-mail ou mot de passe incorrect.'));
}
function viewPending() {
  $main.innerHTML = `<div class="card center"><h2>Compte en attente</h2>
    <p>Votre compte <b>${esc(S.user.email)}</b> doit être activé par l'administrateur.</p>
    <p class="muted">Demandez-lui d'ouvrir Plus → Utilisateurs.</p>
    <div class="actions"><button class="sec" id="out">Se déconnecter</button></div></div>`;
  el('out').onclick = () => signOut(auth);
}

// ---------- Code PIN (par téléphone) ----------
const pinKey = () => 'pin_' + S.user.uid;
const pinIsSet = () => !!localStorage.getItem(pinKey());
async function sha(s) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
let locked = false, hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (S.user && S.me.active && pinIsSet() && !locked && Date.now() - hiddenAt > (+localStorage.getItem('lockMin') || 5) * 60000) lockScreen(() => {});
});
function lockScreen(after) {
  locked = true;
  let code = '', fails = +(sessionStorage.getItem('pinFails') || 0);
  const o = document.createElement('div'); o.className = 'lock';
  const draw = msg => {
    o.innerHTML = `<img src="${esc(S.settings.logo || 'icons/icon-192.png')}" alt=""><h2>Vente Mobile</h2><p>${esc(meName())} — entrez votre code</p>
      <div class="dots">${[0, 1, 2, 3].map(i => `<span class="${i < code.length ? 'on' : ''}"></span>`).join('')}</div><p class="pos">${esc(msg || '')}</p>
      <div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9, '', 0, '⌫'].map(k => `<button class="${k === '' ? 'ghost' : ''}" data-k="${k}">${k}</button>`).join('')}</div>
      <button class="sec small" data-out>Code oublié ? Se déconnecter</button>`;
    o.querySelectorAll('[data-k]').forEach(b => b.onclick = async () => {
      const k = b.dataset.k; if (k === '') return;
      if (k === '⌫') code = code.slice(0, -1); else if (code.length < 4) code += k;
      draw();
      if (code.length === 4) {
        if (await sha(S.user.uid + ':' + code) === localStorage.getItem(pinKey())) {
          sessionStorage.removeItem('pinFails'); locked = false; o.remove(); after();
        } else {
          fails++; sessionStorage.setItem('pinFails', fails); code = '';
          if (fails >= 5) { o.querySelectorAll('[data-k]').forEach(x => x.disabled = true); draw('Trop d\'essais. Patientez 30 secondes.'); o.querySelectorAll('[data-k]').forEach(x => x.disabled = true); setTimeout(() => { fails = 3; draw(); }, 30000); }
          else draw('Code incorrect');
        }
      }
    });
    o.querySelector('[data-out]').onclick = async () => {
      if (await confirmBox('Se déconnecter ? Il faudra le mot de passe et Internet pour se reconnecter.', { ok: 'Se déconnecter' })) {
        localStorage.removeItem(pinKey()); locked = false; o.remove(); signOut(auth);
      }
    };
  };
  draw(); document.body.appendChild(o);
}

// ---------- Routeur ----------
const routes = [
  [/^#\/?$/, viewDash],
  [/^#\/bon\/new(?:\/(.+))?$/, m => viewBonEdit({ clientId: m[1] })],
  [/^#\/bon\/edit\/(.+)$/, m => viewBonEdit({ id: m[1] })],
  [/^#\/bon\/(.+)$/, m => viewBon(m[1])],
  [/^#\/bons$/, viewBons],
  [/^#\/clients$/, () => viewPartyList('client')],
  [/^#\/fournisseurs$/, () => viewPartyList('supplier')],
  [/^#\/client\/nouveau-pour-bon$/, () => viewPartyForm('client', null, true)],
  [/^#\/client\/form(?:\/(.+))?$/, m => viewPartyForm('client', m[1])],
  [/^#\/fournisseur\/form(?:\/(.+))?$/, m => viewPartyForm('supplier', m[1])],
  [/^#\/client\/(.+)$/, m => viewClient(m[1])],
  [/^#\/fournisseur\/(.+)$/, m => viewSupplier(m[1])],
  [/^#\/releve\/(c|f)\/(.+)$/, m => viewReleve(m[1], m[2])],
  [/^#\/versement\/c\/(.+)$/, m => viewClientPayment(m[1])],
  [/^#\/versement\/f\/(.+)$/, m => viewSupplierPayment(m[1])],
  [/^#\/recu\/(.+)$/, m => viewRecu(m[1])],
  [/^#\/achat\/new\/(.+)$/, m => viewPurchase({ supplierId: m[1] })],
  [/^#\/achat\/(.+)$/, m => viewPurchase({ id: m[1] })],
  [/^#\/produits$/, viewProducts],
  [/^#\/plus$/, viewMore],
  [/^#\/config$/, viewConfig],
  [/^#\/utilisateurs$/, viewUsers],
  [/^#\/journal$/, viewJournal],
  [/^#\/verification$/, viewCheck],
  [/^#\/sauvegarde$/, viewBackup],
];
function render() {
  if (!S.user || !S.me.active) return;
  stop(viewSubs); current = {};
  $main.innerHTML = '';
  const h = curHash(); lastHash = h;
  document.querySelectorAll('nav a').forEach(a => {
    const href = a.getAttribute('href');
    a.classList.toggle('on', href === '#/' ? h === '#/' : h.startsWith(href));
  });
  window.scrollTo(0, 0);
  for (const [re, fn] of routes) { const m = h.match(re); if (m) return fn(m); }
  viewDash();
}
const back = () => history.back();
const loading = () => { $main.innerHTML = '<p class="muted center">Chargement…</p>'; };
const statusBadge = s => s === 'cancelled' ? '<span class="badge ann">Annulé</span>' : s === 'modified' ? '<span class="badge mod">Modifié</span>' : '';
const sumBy = (arr, f) => r2(arr.reduce((s, x) => s + f(x), 0));

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
const PERIODS = { day: 'Jour', week: 'Semaine', month: 'Mois', year: 'Année', custom: 'Période' };
let dashPeriod = 'day', dashFrom = isoDay(new Date()), dashTo = isoDay(new Date());
function viewDash() {
  let sales = [], pays = [], purch = [];
  const subscribe = () => {
    stop(viewSubs);
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
    const tot = sumBy(sales, x => x.total), vPay = sumBy(pays, x => x.amount);
    const enc = r2(sumBy(sales, x => x.paid || 0) + vPay);
    const cre = sumBy(S.clients, x => x.balance || 0), dette = sumBy(S.suppliers, x => x.balance || 0);
    const bySeller = {};
    sales.forEach(x => { bySeller[x.createdByName] = (bySeller[x.createdByName] || 0) + x.total; });
    const top = S.clients.filter(c => (c.balance || 0) > 0).sort((a, b) => b.balance - a.balance).slice(0, 5);
    $main.innerHTML = `
      <div class="tabs">${Object.entries(PERIODS).map(([k, v]) => `<button data-p="${k}" class="${k === dashPeriod ? 'on' : ''}">${v}</button>`).join('')}</div>
      ${dashPeriod === 'custom' ? `<div class="row"><input type="date" id="df" value="${dashFrom}"><input type="date" id="dt" value="${dashTo}"></div><br>` : ''}
      <div class="grid2">
        <div class="stat"><div class="l">Ventes (${sales.length} bon${sales.length > 1 ? 's' : ''})</div><div class="v">${fmt(tot)}</div></div>
        <div class="stat"><div class="l">Encaissé</div><div class="v neg">${fmt(enc)}</div></div>
        <div class="stat"><div class="l">Achats fournisseurs</div><div class="v">${fmt(sumBy(purch, x => x.amount))}</div></div>
        <div class="stat"><div class="l">Versements hors bons</div><div class="v">${fmt(vPay)}</div></div>
      </div>
      <h3>Soldes actuels</h3>
      <div class="grid2">
        <a class="stat link" href="#/clients" data-tab><div class="l">Total créances clients</div><div class="v pos">${fmt(cre)}</div></a>
        <a class="stat link" href="#/fournisseurs" data-tab><div class="l">Total dû aux fournisseurs</div><div class="v pos">${fmt(dette)}</div></a>
      </div>
      <h3>Ventes par vendeur</h3>
      <div class="list">${Object.entries(bySeller).map(([k, v]) => `<div class="it"><span>${esc(k)}</span><span class="amt">${fmt(v)}</span></div>`).join('') || '<p class="muted">Aucune vente sur la période.</p>'}</div>
      ${top.length ? `<h3>Clients qui doivent le plus</h3><div class="list">${top.map(c => `<a href="#/client/${c.id}"><span>${esc(c.name)}</span><span class="amt pos">${fmt(c.balance)}</span></a>`).join('')}</div>` : ''}
      <div class="actions"><a class="btn" href="#/bon/new" data-tab>🧾 Nouveau bon</a></div>`;
    $main.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { dashPeriod = b.dataset.p; subscribe(); draw(); });
    if (el('df')) { el('df').onchange = e => { dashFrom = e.target.value; subscribe(); }; el('dt').onchange = e => { dashTo = e.target.value; subscribe(); }; }
  };
  subscribe(); draw();
  current.onState = draw;
}

// ---------- Bon de vente : création / modification ----------
const canEditSale = s => s.status !== 'cancelled' && (isAdmin() || s.createdBy === S.user.uid);
function viewBonEdit({ id, clientId }) {
  const dkey = 'draft_' + S.user.uid;
  let sale = null, items = [], paid = '', cid = '', original = '', restored = false;
  const sig = () => JSON.stringify([items.map(x => [x.name, num(x.qty), x.unit, num(x.price)]), num(paid)]);
  const saveDraft = () => { if (!sale) { if (items.length || cid) localStorage.setItem(dkey, JSON.stringify({ cid, items, paid, at: Date.now() })); } };
  const total = () => r2(items.reduce((s, x) => s + r2(num(x.qty) * num(x.price)), 0));
  const prev = () => sale ? sale.prevBalance : (clientById(cid)?.balance || 0);
  current.dirty = () => !!sale && sig() !== original;

  async function init() {
    loading();
    if (id) {
      const d = await getDoc(doc(db, 'sales', id));
      if (!d.exists()) { $main.innerHTML = '<p>Bon introuvable.</p>'; return; }
      sale = { id: d.id, ...d.data() };
      if (!canEditSale(sale)) { await alertBox(sale.status === 'cancelled' ? 'Ce bon est annulé, il ne peut plus être modifié.' : 'Seul l\'auteur du bon ou l\'administrateur peut le modifier.'); return nav('#/bon/' + id, { replace: true }); }
      items = sale.items.map(x => ({ ...x })); paid = sale.paid || ''; cid = sale.clientId; original = sig();
    } else {
      let dr = null; try { dr = JSON.parse(localStorage.getItem(dkey) || 'null'); } catch (e) {}
      const picked = localStorage.getItem('pickClient'); localStorage.removeItem('pickClient');
      if (dr && dr.items?.length) {
        if (clientId && dr.cid && dr.cid !== clientId) {
          const ok = await confirmBox(`Un bon non terminé existe pour ${clientById(dr.cid)?.name || 'un autre client'} (${dr.items.length} article(s)).\nLe reprendre ?`, { ok: 'Reprendre', cancel: 'Nouveau bon' });
          if (ok) { ({ cid, items, paid } = dr); restored = true; } else { localStorage.removeItem(dkey); cid = clientId; }
        } else { ({ cid, items, paid } = dr); if (clientId) cid = clientId; restored = true; }
      } else cid = clientId || dr?.cid || '';
      if (picked) cid = picked;
    }
    draw();
  }
  const updTotals = () => {
    items.forEach((x, i) => { const t = $main.querySelector(`[data-tot="${i}"]`); if (t) t.textContent = fmt(num(x.qty) * num(x.price)); });
    if (!el('t-total')) return;
    el('t-total').textContent = fmt(total());
    el('t-prev').textContent = fmt(prev());
    const ns = r2(prev() + total() - num(paid));
    el('t-new').textContent = fmt(ns); el('t-new').className = ns > 0 ? 'pos' : 'neg';
    saveDraft();
  };
  const chooseClient = () => picker({
    title: 'Choisir le client',
    items: S.clients.map(c => ({ id: c.id, label: c.name, sub: [c.phone, c.address].filter(Boolean).join(' · '), right: fmt(c.balance || 0), search: (c.phone || '') + ' ' + (c.address || '') })),
    onPick: it => { cid = it.id; saveDraft(); draw(); return true; },
    extra: { label: '+ Nouveau client', onClick: () => { saveDraft(); nav('#/client/nouveau-pour-bon'); } },
    emptyText: 'Aucun client trouvé'
  });
  const addProducts = () => {
    const qtyOf = pid => items.filter(x => x.productId === pid).reduce((s, x) => s + num(x.qty), 0);
    const list = S.products.map(p => ({ id: p.id, label: p.name, sub: fmt(p.price) + ' / ' + unitShort(p.unit), count: qtyOf(p.id) }));
    picker({
      title: 'Ajouter des produits', keepOpen: true, items: list,
      onPick: it => {
        const p = S.products.find(x => x.id === it.id);
        const ex = items.find(x => x.productId === p.id);
        if (ex) ex.qty = r3(num(ex.qty) + 1); else items.push({ productId: p.id, name: p.name, qty: 1, unit: p.unit || 'piece', price: p.price });
        it.count = qtyOf(p.id); toast(p.name + ' ajouté'); saveDraft();
        return false;
      },
      onClose: draw,
      extra: { label: '+ Créer un produit dans la liste', onClick: () => { saveDraft(); nav('#/produits'); } },
      emptyText: 'Aucun produit — utilisez « Article libre »'
    });
  };
  const draw = () => {
    const c = clientById(cid);
    $main.innerHTML = `
      <h2>${sale ? 'Modifier le bon ' + esc(sale.number) : 'Nouveau bon de vente'}</h2>
      ${sale ? '<p class="note mod">La modification sera tracée : l\'ancienne version est conservée.</p>' : ''}
      ${restored ? '<p class="note">Brouillon repris. <a href="javascript:void 0" id="clr">Vider le bon</a></p>' : ''}
      <div class="card pick ${sale ? 'fixed' : ''}" id="pickc">
        ${c ? `<div><b>${esc(c.name)}</b><div class="sub">Solde actuel : ${fmt(c.balance || 0)}</div></div>` : '<div class="muted">👤 Choisir le client…</div>'}
        ${sale ? '' : '<span>›</span>'}</div>
      <h3>Articles ${items.length ? `(${items.length})` : ''}</h3>
      <div id="lines">${items.map((x, i) => `
        <div class="line">
          <div class="row"><input data-i="${i}" data-f="name" value="${esc(x.name)}" placeholder="Désignation">
            <button class="danger small fit" data-del="${i}" aria-label="Supprimer">✕</button></div>
          <div class="row qrow">
            <button class="sec fit" data-q="${i}" data-s="-1">−</button>
            <input data-i="${i}" data-f="qty" type="number" inputmode="decimal" step="any" value="${x.qty}" placeholder="Qté">
            <button class="sec fit" data-q="${i}" data-s="1">+</button>
            <select data-i="${i}" data-f="unit"><option value="piece" ${x.unit !== 'kg' ? 'selected' : ''}>pièce</option><option value="kg" ${x.unit === 'kg' ? 'selected' : ''}>kg</option></select>
          </div>
          <div class="row"><span class="muted small-t">Prix unitaire</span><input data-i="${i}" data-f="price" type="number" inputmode="decimal" step="any" value="${x.price}" placeholder="Prix">
            <span class="tot" data-tot="${i}">${fmt(num(x.qty) * num(x.price))}</span></div>
        </div>`).join('') || '<p class="muted">Aucun article.</p>'}</div>
      <div class="row"><button id="addp">+ Produits</button><button class="sec" id="free">+ Article libre</button></div>
      <div class="card totals">
        <div class="row big"><span>Total bon</span><span id="t-total"></span></div>
        <div class="row"><span>Ancien solde</span><span id="t-prev"></span></div>
        <div class="row"><span>Versement</span><input id="paid" type="number" inputmode="decimal" step="any" value="${paid}" placeholder="0"></div>
        <div class="chips"><button class="sec small" data-pay="0">Rien</button><button class="sec small" data-pay="bon">Montant du bon</button><button class="sec small" data-pay="all">Tout le solde</button></div>
        <div class="row big"><span>Nouveau solde</span><span id="t-new"></span></div>
      </div>
      <div class="actions"><button id="save">💾 Enregistrer</button><button id="savep">🖨️ Enregistrer + imprimer</button></div>`;
    updTotals();
    if (!sale) el('pickc').onclick = chooseClient;
    if (el('clr')) el('clr').onclick = async () => { if (await confirmBox('Vider ce bon ?', { ok: 'Vider', danger: true })) { localStorage.removeItem(dkey); items = []; paid = ''; restored = false; draw(); } };
    $main.querySelectorAll('[data-f]').forEach(inp => {
      const h = e => { items[+inp.dataset.i][inp.dataset.f] = e.target.value; updTotals(); };
      inp.oninput = h; inp.onchange = h;
    });
    $main.querySelectorAll('[data-q]').forEach(b => b.onclick = () => {
      const x = items[+b.dataset.q]; x.qty = Math.max(0, r3(num(x.qty) + +b.dataset.s));
      $main.querySelector(`[data-i="${b.dataset.q}"][data-f="qty"]`).value = x.qty; updTotals();
    });
    $main.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { items.splice(+b.dataset.del, 1); saveDraft(); if (!items.length && !sale) localStorage.removeItem(dkey); draw(); });
    $main.querySelectorAll('[data-pay]').forEach(b => b.onclick = () => {
      const v = b.dataset.pay; paid = v === '0' ? '' : v === 'bon' ? total() : r2(Math.max(0, prev() + total()));
      el('paid').value = paid; updTotals();
    });
    el('addp').onclick = addProducts;
    el('free').onclick = () => { items.push({ productId: null, name: '', qty: 1, unit: 'piece', price: '' }); draw(); $main.querySelector(`[data-i="${items.length - 1}"][data-f="name"]`).focus(); };
    el('paid').oninput = e => { paid = e.target.value; updTotals(); };
    guard(el('save'), () => save(false));
    guard(el('savep'), () => save(true));
  };
  const save = async (print) => {
    const clean = items.map(x => ({ productId: x.productId || null, name: String(x.name).trim(), qty: r3(num(x.qty)), unit: x.unit === 'kg' ? 'kg' : 'piece', price: r2(num(x.price)), total: r2(num(x.qty) * num(x.price)) }))
      .filter(x => x.name || x.qty || x.price);
    if (!cid || !clientById(cid)) return alertBox('Choisissez un client.');
    if (!clean.length) return alertBox('Ajoutez au moins un article.');
    if (clean.some(x => !x.name || x.qty <= 0)) return alertBox('Chaque article doit avoir une désignation et une quantité supérieure à 0.');
    if (clean.some(x => x.price <= 0) && !(await confirmBox('Un article a un prix à 0. Continuer ?'))) return;
    const tot = r2(clean.reduce((s, x) => s + x.total, 0)), pd = r2(num(paid));
    if (pd < 0) return alertBox('Le versement ne peut pas être négatif.');
    const b = writeBatch(db);
    let saleId, data;
    if (!sale) {
      const c = clientById(cid);
      const ref = doc(collection(db, 'sales')); saleId = ref.id;
      data = {
        number: nextNumber('bonCounter', '', b), clientId: cid, clientName: c.name, items: clean, total: tot, paid: pd,
        prevBalance: r2(c.balance || 0), newBalance: r2((c.balance || 0) + tot - pd), status: 'ok',
        createdAt: now(), createdBy: S.user.uid, createdByName: meName(), syncedAt: serverTimestamp(), history: []
      };
      b.set(ref, data);
      b.update(doc(db, 'clients', cid), { balance: increment(r2(tot - pd)) });
      logJ(b, 'Création bon', `Bon ${data.number} — ${c.name} — total ${fmt(tot)}, versé ${fmt(pd)}`, 'sale', saleId, [cid], null, { items: clean, total: tot, paid: pd });
    } else {
      const delta = r2((tot - pd) - (sale.total - (sale.paid || 0)));
      const msg = `Ancien total : ${fmt(sale.total)} → nouveau : ${fmt(tot)}\nAncien versement : ${fmt(sale.paid)} → nouveau : ${fmt(pd)}\n\nLe solde du client sera ajusté de ${delta >= 0 ? '+' : ''}${fmt(delta)}.\nL'ancienne version restera visible.`;
      if (!(await confirmBox(msg, { title: 'Modifier le bon ' + sale.number + ' ?', ok: 'Modifier' }))) return;
      saleId = sale.id;
      const upd = {
        items: clean, total: tot, paid: pd, newBalance: r2(sale.prevBalance + tot - pd), status: 'modified',
        modifiedAt: now(), modifiedBy: S.user.uid, modifiedByName: meName(),
        history: arrayUnion({ at: now(), byName: meName(), items: sale.items, total: sale.total, paid: sale.paid || 0 })
      };
      b.update(doc(db, 'sales', saleId), upd);
      if (delta) b.update(doc(db, 'clients', cid), { balance: increment(delta) });
      logJ(b, 'Modification bon', `Bon ${sale.number} — ${sale.clientName} — total ${fmt(sale.total)} → ${fmt(tot)}, versé ${fmt(sale.paid)} → ${fmt(pd)}`, 'sale', saleId, [cid],
        { items: sale.items, total: sale.total, paid: sale.paid || 0 }, { items: clean, total: tot, paid: pd });
      data = { ...sale, ...upd };
      original = sig();
    }
    commit(b, 'Bon enregistré');
    if (!sale) localStorage.removeItem(dkey);
    current.dirty = null;
    nav('#/bon/' + saleId, { replace: true });
    if (print) printTicket(bonTicket(data));
  };
  init();
  current.onState = () => {
    if (!el('pickc')) return;
    // la liste des clients/soldes a changé : mise à jour sans perdre la saisie
    const c = clientById(cid), card = el('pickc');
    if (c && !card.querySelector('b')) draw(); else updTotals();
  };
}

// ---------- Bon : consultation ----------
function viewBon(id) {
  loading();
  viewSubs.push(onSnapshot(doc(db, 'sales', id), d => {
    if (!d.exists()) { $main.innerHTML = '<p>Bon introuvable.</p>'; return; }
    const s = { id: d.id, ...d.data() };
    $main.innerHTML = `
      <h2>Bon ${esc(s.number)} ${statusBadge(s.status)}</h2>
      <p class="muted small-t">Créé le ${fdt(s.createdAt)} par ${esc(s.createdByName)}${s.syncedAt ? ` · reçu par le serveur le ${fdt(s.syncedAt)}` : ' · ⏳ pas encore envoyé'}
        ${s.status === 'modified' ? `<br>Modifié le ${fdt(s.modifiedAt)} par ${esc(s.modifiedByName)}` : ''}
        ${s.status === 'cancelled' ? `<br>Annulé le ${fdt(s.cancelledAt)} par ${esc(s.cancelledByName)}` : ''}</p>
      <pre class="ticket">${esc(ticketText(bonTicket(s)))}</pre>
      <div class="actions"><button id="pr">🖨️ Imprimer</button><button class="sec" id="sh">📤 Partager</button></div>
      <div class="actions">
        ${canEditSale(s) ? `<a class="btn sec" href="#/bon/edit/${s.id}">✏️ Modifier</a>` : ''}
        ${isAdmin() && s.status !== 'cancelled' ? '<button class="danger" id="cancel">Annuler le bon</button>' : ''}
        <a class="btn sec" href="#/client/${s.clientId}">👤 Client</a>
      </div>
      ${(s.history || []).length ? '<h3>Versions précédentes</h3>' + s.history.slice().reverse().map(h => `
        <div class="hist">Avant la modification du ${fdt(h.at)} (par ${esc(h.byName)}) :<br>
          ${h.items.map(i => `${esc(i.name)} : ${fq(i.qty)} ${unitShort(i.unit)} × ${fmt(i.price)} = ${fmt(i.total)}`).join('<br>')}
          <br><b>Total ${fmt(h.total)} — versement ${fmt(h.paid)}</b></div>`).join('') : ''}`;
    el('pr').onclick = () => printTicket(bonTicket(s));
    el('sh').onclick = () => shareTicket(bonTicket(s), 'Bon ' + s.number);
    if (el('cancel')) guard(el('cancel'), async () => {
      const amt = r2(s.total - (s.paid || 0));
      if (!(await confirmBox(`Le solde du client sera diminué de ${fmt(amt)}.\nLe bon restera visible avec la mention ANNULÉ.`, { title: 'Annuler le bon ' + s.number + ' ?', ok: 'Annuler le bon', cancel: 'Retour', danger: true }))) return;
      const b = writeBatch(db);
      b.update(doc(db, 'sales', s.id), { status: 'cancelled', cancelledAt: now(), cancelledBy: S.user.uid, cancelledByName: meName() });
      b.update(doc(db, 'clients', s.clientId), { balance: increment(-amt) });
      logJ(b, 'Annulation bon', `Bon ${s.number} — ${s.clientName} — total ${fmt(s.total)}`, 'sale', s.id, [s.clientId], { status: s.status }, { status: 'cancelled' });
      commit(b, 'Bon annulé');
    });
  }));
}

// ---------- Liste des bons ----------
function viewBons() {
  let list = [], f = '';
  loading();
  viewSubs.push(onSnapshot(query(collection(db, 'sales'), orderBy('createdAt', 'desc'), limit(300)), s => {
    list = s.docs.map(d => ({ id: d.id, ...d.data() })); draw();
  }));
  const draw = () => {
    const rows = list.filter(s => match(s.number + ' ' + s.clientName + ' ' + s.createdByName, f));
    const html = rows.map(s => `<a href="#/bon/${s.id}" class="${s.status === 'cancelled' ? 'cancelled' : ''}">
        <div><b>${esc(s.number)}</b> ${statusBadge(s.status)}<div class="sub">${esc(s.clientName)} · ${fdt(s.createdAt)} · ${esc(s.createdByName)}</div></div>
        <span class="amt">${fmt(s.total)}</span></a>`).join('') || '<p class="muted">Aucun bon.</p>';
    if (!el('f')) {
      $main.innerHTML = `<h2>Bons de vente</h2><input id="f" type="search" placeholder="🔍 N° de bon, client ou vendeur"><div class="list" id="ls" style="margin-top:10px"></div>`;
      el('f').oninput = e => { f = e.target.value; draw(); };
    }
    el('ls').innerHTML = html;
  };
}

// ---------- Clients / fournisseurs ----------
const listPrefs = { client: { f: '', debt: false, sort: 'name' }, supplier: { f: '', debt: false, sort: 'name' } };
function viewPartyList(kind) {
  const isC = kind === 'client', P = listPrefs[kind], base = isC ? 'client' : 'fournisseur';
  const draw = () => {
    const all = isC ? S.clients : S.suppliers;
    let rows = all.filter(x => match(x.name + ' ' + (x.phone || '') + ' ' + (x.address || ''), P.f) && (!P.debt || (x.balance || 0) > 0));
    if (P.sort === 'bal') rows = rows.slice().sort((a, b) => (b.balance || 0) - (a.balance || 0));
    const html = rows.map(x => `<a href="#/${base}/${x.id}">
        <div>${esc(x.name)}<div class="sub">${esc([x.phone, x.address].filter(Boolean).join(' · '))}</div></div>
        <span class="amt ${(x.balance || 0) > 0 ? 'pos' : 'neg'}">${fmt(x.balance || 0)}</span></a>`).join('') || '<p class="muted">Aucun résultat.</p>';
    if (!el('f')) {
      $main.innerHTML = `<h2>${isC ? 'Clients' : 'Fournisseurs'}</h2>
        <div class="stat"><div class="l">${isC ? 'Total créances' : 'Total dû'}</div><div class="v pos" id="tot"></div></div>
        <div class="row" style="margin-top:10px"><input id="f" type="search" placeholder="🔍 Nom, téléphone, adresse" value="${esc(P.f)}"><a class="btn fit" href="#/${base}/form">+ Ajouter</a></div>
        <div class="chips"><button class="small" id="debt"></button><button class="small" id="sort"></button></div>
        <div class="list" id="ls"></div>`;
      el('f').oninput = e => { P.f = e.target.value; draw(); };
      el('debt').onclick = () => { P.debt = !P.debt; draw(); };
      el('sort').onclick = () => { P.sort = P.sort === 'name' ? 'bal' : 'name'; draw(); };
    }
    el('tot').textContent = fmt(sumBy(all, x => x.balance || 0));
    el('debt').textContent = P.debt ? (isC ? '✓ Qui doivent' : '✓ À payer') : (isC ? 'Qui doivent' : 'À payer');
    el('debt').className = 'small ' + (P.debt ? '' : 'sec');
    el('sort').textContent = P.sort === 'name' ? 'Tri : nom' : 'Tri : solde';
    el('sort').className = 'small sec';
    el('ls').innerHTML = html;
  };
  draw(); current.onState = draw;
}

function viewPartyForm(kind, id, forBon = false) {
  const isC = kind === 'client', col = isC ? 'clients' : 'suppliers', base = isC ? 'client' : 'fournisseur';
  const x = id ? (isC ? clientById(id) : supplierById(id)) : null;
  if (id && !x) { loading(); current.onState = () => viewPartyForm(kind, id); return; }
  const lockOB = x && !isAdmin();
  $main.innerHTML = `<h2>${x ? 'Modifier' : 'Nouveau'} ${isC ? 'client' : 'fournisseur'}</h2>
    <label>Nom *</label><input id="n" value="${esc(x?.name || '')}">
    <label>Téléphone</label><input id="t" type="tel" value="${esc(x?.phone || '')}">
    <label>Adresse</label><input id="a" value="${esc(x?.address || '')}">
    <label>Solde de départ ${isC ? '(ce que le client vous doit)' : '(ce que vous devez au fournisseur)'}</label>
    <input id="o" type="number" inputmode="decimal" step="any" value="${x ? (x.openingBalance || 0) : ''}" placeholder="0" ${lockOB ? 'disabled' : ''}>
    ${lockOB ? '<p class="muted small-t">Seul l\'administrateur peut modifier un solde de départ.</p>' : x ? '<p class="muted small-t">Changer le solde de départ ajuste le solde actuel de la même différence (tracé dans le journal).</p>' : ''}
    <div class="actions"><button id="s">💾 Enregistrer</button><button class="sec" id="bk">Retour</button></div>`;
  const orig = () => JSON.stringify([x?.name || '', x?.phone || '', x?.address || '', String(x ? (x.openingBalance || 0) : '')]);
  const cur = () => JSON.stringify([el('n').value.trim(), el('t').value.trim(), el('a').value.trim(), el('o').value]);
  current.dirty = () => !!el('n') && cur() !== orig() && !!el('n').value.trim();
  el('bk').onclick = back;
  guard(el('s'), async () => {
    const name = el('n').value.trim(); if (!name) return alertBox('Le nom est obligatoire.');
    const all = isC ? S.clients : S.suppliers;
    if (all.some(c => c.id !== x?.id && c.name.trim().toLowerCase() === name.toLowerCase()) && !(await confirmBox(`Un ${isC ? 'client' : 'fournisseur'} « ${name} » existe déjà. Créer quand même ?`))) return;
    const ob = r2(num(el('o').value));
    const b = writeBatch(db);
    const data = { name, phone: el('t').value.trim(), address: el('a').value.trim() };
    let ref;
    if (x) {
      ref = doc(db, col, x.id);
      const d = lockOB ? 0 : r2(ob - (x.openingBalance || 0));
      if (d && !(await confirmBox(`Solde de départ : ${fmt(x.openingBalance || 0)} → ${fmt(ob)}.\nLe solde actuel sera ajusté de ${d > 0 ? '+' : ''}${fmt(d)}.`, { title: 'Confirmer ?' }))) return;
      const upd = { ...data, updatedAt: now(), updatedByName: meName() };
      if (d) { upd.openingBalance = ob; upd.balance = increment(d); }
      b.update(ref, upd);
      logJ(b, `Modification ${isC ? 'client' : 'fournisseur'}`, `${x.name}${x.name !== name ? ' → ' + name : ''}${d ? ` — solde de départ ${fmt(x.openingBalance || 0)} → ${fmt(ob)}` : ''}`, kind, x.id, [],
        { name: x.name, phone: x.phone || '', address: x.address || '', openingBalance: x.openingBalance || 0 }, { ...data, openingBalance: d ? ob : (x.openingBalance || 0) });
    } else {
      ref = doc(collection(db, col));
      b.set(ref, { ...data, openingBalance: ob, balance: ob, createdAt: now(), createdBy: S.user.uid, createdByName: meName() });
      logJ(b, `Création ${isC ? 'client' : 'fournisseur'}`, `${name} — solde de départ ${fmt(ob)}`, kind, ref.id, [], null, { ...data, openingBalance: ob });
    }
    commit(b, 'Enregistré');
    current.dirty = null;
    if (forBon) { localStorage.setItem('pickClient', ref.id); back(); }
    else nav(`#/${base}/${ref.id}`, { replace: true });
  });
}

function journalSheet(id, title) {
  const sh = sheet('Journal — ' + title, '<div class="list jl"><p class="muted center">Chargement…</p></div>');
  getDocs(query(collection(db, 'journal'), where('keys', 'array-contains', id))).then(s => {
    const rows = s.docs.map(d => d.data()).sort((a, b) => ms(b.atDevice) - ms(a.atDevice));
    sh.root.querySelector('.jl').innerHTML = rows.map(j => `<div class="it col"><div><b>${esc(j.action)}</b> <span class="sub">${fdt(j.atDevice)} · ${esc(j.byName)}</span></div><div class="sub">${esc(j.label)}</div></div>`).join('') || '<p class="muted center">Aucune entrée.</p>';
  }).catch(e => { sh.root.querySelector('.jl').innerHTML = `<p class="pos">${esc(e.message)}</p>`; });
}
function contactButtons(x) {
  if (!x.phone) return '';
  return `<a class="btn sec" href="tel:${esc(x.phone)}" target="_self" data-ext>📞 Appeler</a><a class="btn sec" href="https://wa.me/${waPhone(x.phone)}" target="_blank" rel="noopener" data-ext>💬 WhatsApp</a>`;
}

function viewClient(id) {
  let sales = [], pays = [];
  viewSubs.push(onSnapshot(query(collection(db, 'sales'), where('clientId', '==', id)), s => { sales = s.docs.map(d => ({ id: d.id, t: 'sale', ...d.data() })); draw(); }));
  viewSubs.push(onSnapshot(query(collection(db, 'clientPayments'), where('clientId', '==', id)), s => { pays = s.docs.map(d => ({ id: d.id, t: 'pay', ...d.data() })); draw(); }));
  const draw = () => {
    const c = clientById(id);
    if (!c) return loading();
    const rows = [...sales, ...pays].sort((a, b) => ms(b.createdAt) - ms(a.createdAt));
    $main.innerHTML = `<h2>${esc(c.name)}</h2>
      <p class="muted">${esc([c.phone, c.address].filter(Boolean).join(' · '))}</p>
      <div class="grid2"><div class="stat"><div class="l">Solde actuel</div><div class="v ${(c.balance || 0) > 0 ? 'pos' : 'neg'}">${fmt(c.balance || 0)}</div></div>
        <div class="stat"><div class="l">Solde de départ</div><div class="v">${fmt(c.openingBalance || 0)}</div></div></div>
      <div class="actions"><a class="btn" href="#/bon/new/${c.id}">🧾 Nouveau bon</a><a class="btn" href="#/versement/c/${c.id}">💰 Versement</a></div>
      <div class="actions">${contactButtons(c)}<a class="btn sec" href="#/releve/c/${c.id}">📄 Relevé</a>
        <a class="btn sec" href="#/client/form/${c.id}">✏️ Modifier</a><button class="sec" id="jr">🕓 Journal</button></div>
      <h3>Historique</h3>
      <div class="list">${rows.map(r => r.t === 'sale' ? `
        <a href="#/bon/${r.id}" class="${r.status === 'cancelled' ? 'cancelled' : ''}"><div>🧾 Bon ${esc(r.number)} ${statusBadge(r.status)}
          <div class="sub">${fdt(r.createdAt)} · ${esc(r.createdByName)}${r.paid ? ' · versé ' + fmt(r.paid) : ''}</div></div>
          <span class="amt pos">+${fmt(r.total)}</span></a>` : `
        <a href="#/recu/${r.id}" class="${r.status === 'cancelled' ? 'cancelled' : ''}"><div>💰 Versement ${esc(r.number || '')} ${statusBadge(r.status)}
          <div class="sub">${fdt(r.createdAt)} · ${esc(r.createdByName)}${r.note ? ' · ' + esc(r.note) : ''}</div></div>
          <span class="amt neg">−${fmt(r.amount)}</span></a>`).join('') || '<p class="muted">Aucune opération.</p>'}
        <div class="it"><div>Solde de départ</div><span class="amt">${fmt(c.openingBalance || 0)}</span></div></div>`;
    el('jr').onclick = () => journalSheet(c.id, c.name);
  };
  draw(); current.onState = draw;
}

function viewSupplier(id) {
  let purch = [], pays = [];
  viewSubs.push(onSnapshot(query(collection(db, 'purchases'), where('supplierId', '==', id)), s => { purch = s.docs.map(d => ({ id: d.id, t: 'buy', ...d.data() })); draw(); }));
  viewSubs.push(onSnapshot(query(collection(db, 'supplierPayments'), where('supplierId', '==', id)), s => { pays = s.docs.map(d => ({ id: d.id, t: 'pay', ...d.data() })); draw(); }));
  const opDay = r => r.t === 'buy' ? (r.invoiceDate || isoDay(toDate(r.createdAt) || new Date())) : isoDay(toDate(r.createdAt) || new Date());
  const draw = () => {
    const f = supplierById(id);
    if (!f) return loading();
    const rows = [...purch, ...pays].sort((a, b) => opDay(b).localeCompare(opDay(a)) || ms(b.createdAt) - ms(a.createdAt));
    $main.innerHTML = `<h2>${esc(f.name)}</h2>
      <p class="muted">${esc([f.phone, f.address].filter(Boolean).join(' · '))}</p>
      <div class="grid2"><div class="stat"><div class="l">Solde dû</div><div class="v ${(f.balance || 0) > 0 ? 'pos' : 'neg'}">${fmt(f.balance || 0)}</div></div>
        <div class="stat"><div class="l">Solde de départ</div><div class="v">${fmt(f.openingBalance || 0)}</div></div></div>
      <div class="actions"><a class="btn" href="#/achat/new/${f.id}">📦 Achat</a><a class="btn" href="#/versement/f/${f.id}">💰 Versement</a></div>
      <div class="actions">${contactButtons(f)}<a class="btn sec" href="#/releve/f/${f.id}">📄 Relevé</a>
        <a class="btn sec" href="#/fournisseur/form/${f.id}">✏️ Modifier</a><button class="sec" id="jr">🕓 Journal</button></div>
      <h3>Historique</h3>
      <div class="list">${rows.map(r => r.t === 'buy' ? `
        <a href="#/achat/${r.id}" class="${r.status === 'cancelled' ? 'cancelled' : ''}"><div>📦 Achat ${r.invoiceNo ? 'fact. ' + esc(r.invoiceNo) : ''} ${statusBadge(r.status)}
          <div class="sub">Facture du ${fday(r.invoiceDate)} · saisi par ${esc(r.createdByName)}</div></div>
          <span class="amt pos">+${fmt(r.amount)}</span></a>` : `
        <div class="it ${r.status === 'cancelled' ? 'cancelled' : ''}"><div>💰 Versement ${statusBadge(r.status)}
          <div class="sub">${fdt(r.createdAt)} · ${esc(r.createdByName)}${r.note ? ' · ' + esc(r.note) : ''}</div>
          ${r.status !== 'cancelled' && isAdmin() ? `<button class="small sec" data-cp="${r.id}">Annuler</button>` : ''}</div>
          <span class="amt neg">−${fmt(r.amount)}</span></div>`).join('') || '<p class="muted">Aucune opération.</p>'}
        <div class="it"><div>Solde de départ</div><span class="amt">${fmt(f.openingBalance || 0)}</span></div></div>`;
    el('jr').onclick = () => journalSheet(f.id, f.name);
    $main.querySelectorAll('[data-cp]').forEach(btn => guard(btn, async () => {
      const p = pays.find(x => x.id === btn.dataset.cp);
      if (!(await confirmBox(`Le solde dû au fournisseur augmentera de ${fmt(p.amount)}.`, { title: 'Annuler ce versement ?', ok: 'Annuler le versement', cancel: 'Retour', danger: true }))) return;
      const b = writeBatch(db);
      b.update(doc(db, 'supplierPayments', p.id), { status: 'cancelled', cancelledAt: now(), cancelledBy: S.user.uid, cancelledByName: meName() });
      b.update(doc(db, 'suppliers', id), { balance: increment(p.amount) });
      logJ(b, 'Annulation versement fournisseur', `${f.name} — ${fmt(p.amount)} du ${fdt(p.createdAt)}`, 'supplierPayment', p.id, [id]);
      commit(b, 'Versement annulé');
    }));
  };
  draw(); current.onState = draw;
}

// ---------- Relevé de compte ----------
function viewReleve(k, id) {
  const isC = k === 'c';
  let A = [], B = [], from = '';
  const cols = isC ? ['sales', 'clientPayments', 'clientId'] : ['purchases', 'supplierPayments', 'supplierId'];
  viewSubs.push(onSnapshot(query(collection(db, cols[0]), where(cols[2], '==', id)), s => { A = s.docs.map(d => d.data()); draw(); }));
  viewSubs.push(onSnapshot(query(collection(db, cols[1]), where(cols[2], '==', id)), s => { B = s.docs.map(d => d.data()); draw(); }));
  const compute = x => {
    const ops = [];
    for (const a of A.filter(a => a.status !== 'cancelled')) {
      if (isC) {
        ops.push({ date: toDate(a.createdAt), label: 'Bon ' + a.number, amount: a.total });
        if (a.paid) ops.push({ date: toDate(a.createdAt), label: 'Versé sur bon ' + a.number, amount: -a.paid, o: 1 });
      } else ops.push({ date: parseDay(a.invoiceDate) || toDate(a.createdAt), label: 'Achat' + (a.invoiceNo ? ' fact. ' + a.invoiceNo : ''), amount: a.amount });
    }
    for (const p of B.filter(p => p.status !== 'cancelled')) ops.push({ date: toDate(p.createdAt), label: 'Versement' + (p.number ? ' ' + p.number : ''), amount: -p.amount });
    ops.sort((a, b) => a.date - b.date || (a.o || 0) - (b.o || 0));
    let bal = r2(x.openingBalance || 0);
    const rows = [], start = from ? parseDay(from) : null;
    for (const o of ops) {
      if (start && o.date < start) { bal = r2(bal + o.amount); continue; }
      if (!rows.length) rows.push({ date: start, label: start ? 'Solde au ' + fd(start) : 'Solde de départ', amount: null, balance: bal });
      bal = r2(bal + o.amount); rows.push({ ...o, balance: bal });
    }
    if (!rows.length) rows.push({ date: start, label: start ? 'Solde au ' + fd(start) : 'Solde de départ', amount: null, balance: bal });
    return { rows, final: bal };
  };
  const draw = () => {
    const x = isC ? clientById(id) : supplierById(id);
    if (!x) return loading();
    const { rows, final } = compute(x);
    const diff = r2(final - (x.balance || 0));
    const title = isC ? 'RELEVÉ DE COMPTE CLIENT' : 'RELEVÉ FOURNISSEUR';
    $main.innerHTML = `<h2>Relevé — ${esc(x.name)}</h2>
      <label>Depuis le (vide = depuis le début)</label><input type="date" id="from" value="${from}">
      <table class="tbl"><thead><tr><th>Date</th><th>Opération</th><th class="r">Montant</th><th class="r">Solde</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td>${r.date ? fd(r.date) : ''}</td><td>${esc(r.label)}</td><td class="r ${r.amount > 0 ? 'pos' : 'neg'}">${r.amount === null ? '' : (r.amount > 0 ? '+' : '−') + fmt(Math.abs(r.amount))}</td><td class="r"><b>${fmt(r.balance)}</b></td></tr>`).join('')}
      </tbody><tfoot><tr><td colspan="3"><b>Solde ${isC ? 'du client' : 'dû'}</b></td><td class="r"><b>${fmt(final)}</b></td></tr></tfoot></table>
      ${diff && pending === 0 ? `<p class="note mod">⚠ Le solde enregistré (${fmt(x.balance || 0)}) diffère du recalcul (${fmt(final)}). ${isAdmin() ? 'Utilisez Plus → Vérifier les soldes.' : 'Prévenez l\'administrateur.'}</p>` : ''}
      <div class="actions"><button id="pr">🖨️ Imprimer</button><button class="sec" id="sh">📤 Partager</button></div>`;
    const L = () => releveTicket(title, x.name, rows, final);
    el('pr').onclick = () => printTicket(L());
    el('sh').onclick = () => shareTicket(L(), 'Relevé ' + x.name);
    el('from').onchange = e => { from = e.target.value; draw(); };
  };
  draw(); current.onState = draw;
}

// ---------- Versements ----------
function viewClientPayment(cid) {
  const draw = () => {
    const c = clientById(cid);
    if (!c) return loading();
    $main.innerHTML = `<h2>Versement client</h2>
      <div class="card"><b>${esc(c.name)}</b><div class="sub">Solde actuel : <b class="pos">${fmt(c.balance || 0)}</b></div></div>
      <label>Montant versé *</label><input id="m" type="number" inputmode="decimal" step="any">
      <div class="chips"><button class="sec small" id="all">Tout le solde (${fmt(c.balance || 0)})</button></div>
      <label>Note</label><input id="n" placeholder="Facultatif">
      <div class="actions"><button id="s">💾 Enregistrer</button><button id="sp">🖨️ Enregistrer + reçu</button></div>`;
    current.dirty = () => !!el('m')?.value;
    el('all').onclick = () => { el('m').value = Math.max(0, r2(c.balance || 0)); };
    const save = async print => {
      const amt = r2(num(el('m').value)); if (amt <= 0) return alertBox('Saisissez un montant.');
      if (amt > (c.balance || 0) && !(await confirmBox(`Le versement (${fmt(amt)}) dépasse le solde (${fmt(c.balance || 0)}). Le client aura un solde en sa faveur. Continuer ?`))) return;
      const b = writeBatch(db), ref = doc(collection(db, 'clientPayments'));
      const data = { number: nextNumber('recuCounter', 'R', b), clientId: cid, clientName: c.name, amount: amt, note: el('n').value.trim(),
        prevBalance: r2(c.balance || 0), newBalance: r2((c.balance || 0) - amt), status: 'ok', createdAt: now(), createdBy: S.user.uid, createdByName: meName(), syncedAt: serverTimestamp() };
      b.set(ref, data);
      b.update(doc(db, 'clients', cid), { balance: increment(-amt) });
      logJ(b, 'Versement client', `${data.number} — ${c.name} — ${fmt(amt)}`, 'clientPayment', ref.id, [cid], null, { amount: amt });
      commit(b, 'Versement enregistré');
      current.dirty = null;
      nav('#/recu/' + ref.id, { replace: true });
      if (print) printTicket(recuTicket(data));
    };
    guard(el('s'), () => save(false)); guard(el('sp'), () => save(true));
  };
  draw(); current.onState = () => { if (!el('m')) draw(); };
}

function viewRecu(id) {
  loading();
  viewSubs.push(onSnapshot(doc(db, 'clientPayments', id), d => {
    if (!d.exists()) { $main.innerHTML = '<p>Reçu introuvable.</p>'; return; }
    const p = { id: d.id, ...d.data() };
    $main.innerHTML = `<h2>Versement ${esc(p.number || '')} ${statusBadge(p.status)}</h2>
      <p class="muted small-t">Saisi le ${fdt(p.createdAt)} par ${esc(p.createdByName)}${p.syncedAt ? ` · reçu par le serveur le ${fdt(p.syncedAt)}` : ' · ⏳ pas encore envoyé'}
      ${p.status === 'cancelled' ? `<br>Annulé le ${fdt(p.cancelledAt)} par ${esc(p.cancelledByName)}` : ''}</p>
      <pre class="ticket">${esc(ticketText(recuTicket(p)))}</pre>
      <div class="actions"><button id="pr">🖨️ Imprimer le reçu</button><button class="sec" id="sh">📤 Partager</button></div>
      <div class="actions">${isAdmin() && p.status !== 'cancelled' ? '<button class="danger" id="cancel">Annuler le versement</button>' : ''}
        <a class="btn sec" href="#/client/${p.clientId}">👤 Client</a></div>`;
    el('pr').onclick = () => printTicket(recuTicket(p));
    el('sh').onclick = () => shareTicket(recuTicket(p), 'Reçu ' + (p.number || ''));
    if (el('cancel')) guard(el('cancel'), async () => {
      if (!(await confirmBox(`Le solde du client augmentera de ${fmt(p.amount)}.`, { title: 'Annuler ce versement ?', ok: 'Annuler le versement', cancel: 'Retour', danger: true }))) return;
      const b = writeBatch(db);
      b.update(doc(db, 'clientPayments', p.id), { status: 'cancelled', cancelledAt: now(), cancelledBy: S.user.uid, cancelledByName: meName() });
      b.update(doc(db, 'clients', p.clientId), { balance: increment(p.amount) });
      logJ(b, 'Annulation versement client', `${p.number} — ${p.clientName} — ${fmt(p.amount)}`, 'clientPayment', p.id, [p.clientId]);
      commit(b, 'Versement annulé');
    });
  }));
}

function viewSupplierPayment(sid) {
  const draw = () => {
    const f = supplierById(sid);
    if (!f) return loading();
    $main.innerHTML = `<h2>Versement fournisseur</h2>
      <div class="card"><b>${esc(f.name)}</b><div class="sub">Solde dû : <b class="pos">${fmt(f.balance || 0)}</b></div></div>
      <label>Montant versé *</label><input id="m" type="number" inputmode="decimal" step="any">
      <label>Note</label><input id="n" placeholder="Facultatif (ex. espèces, chèque n°…)">
      <div class="actions"><button id="s">💾 Enregistrer</button></div>`;
    current.dirty = () => !!el('m')?.value;
    guard(el('s'), async () => {
      const amt = r2(num(el('m').value)); if (amt <= 0) return alertBox('Saisissez un montant.');
      const b = writeBatch(db), ref = doc(collection(db, 'supplierPayments'));
      b.set(ref, { supplierId: sid, supplierName: f.name, amount: amt, note: el('n').value.trim(),
        status: 'ok', createdAt: now(), createdBy: S.user.uid, createdByName: meName(), syncedAt: serverTimestamp() });
      b.update(doc(db, 'suppliers', sid), { balance: increment(-amt) });
      logJ(b, 'Versement fournisseur', `${f.name} — ${fmt(amt)}`, 'supplierPayment', ref.id, [sid], null, { amount: amt });
      commit(b, 'Versement enregistré');
      current.dirty = null;
      nav('#/fournisseur/' + sid, { replace: true });
    });
  };
  draw(); current.onState = () => { if (!el('m')) draw(); };
}

// ---------- Achats fournisseurs ----------
function viewPurchase({ id, supplierId }) {
  let p = null;
  const draw = () => {
    const sid = p ? p.supplierId : supplierId, f = supplierById(sid);
    if (!f) return loading();
    const canEdit = !p || (p.status !== 'cancelled' && (isAdmin() || p.createdBy === S.user.uid));
    const ro = !canEdit ? 'disabled' : '';
    $main.innerHTML = `<h2>${p ? 'Achat' : 'Nouvel achat'} ${p ? statusBadge(p.status) : ''}</h2>
      <div class="card"><b>${esc(f.name)}</b><div class="sub">Solde dû : ${fmt(f.balance || 0)}</div></div>
      ${p ? `<p class="muted small-t">Saisi le ${fdt(p.createdAt)} par ${esc(p.createdByName)}${p.status === 'cancelled' ? ` · annulé le ${fdt(p.cancelledAt)} par ${esc(p.cancelledByName)}` : ''}</p>` : ''}
      <label>Montant de l'achat *</label><input id="m" type="number" inputmode="decimal" step="any" value="${p?.amount ?? ''}" ${ro}>
      <label>Date de la facture *</label><input id="d" type="date" value="${p?.invoiceDate || isoDay(new Date())}" ${ro}>
      <label>N° de facture</label><input id="no" value="${esc(p?.invoiceNo || '')}" placeholder="Facultatif" ${ro}>
      <label>Note</label><input id="n" value="${esc(p?.note || '')}" placeholder="Facultatif" ${ro}>
      <div class="actions">${canEdit ? '<button id="s">💾 Enregistrer</button>' : ''}${p && isAdmin() && p.status !== 'cancelled' ? '<button class="danger" id="c">Annuler l\'achat</button>' : ''}</div>
      ${(p?.history || []).length ? '<h3>Versions précédentes</h3>' + p.history.slice().reverse().map(h =>
        `<div class="hist">Avant la modification du ${fdt(h.at)} (par ${esc(h.byName)}) : montant ${fmt(h.amount)}, facture du ${fday(h.invoiceDate)}${h.invoiceNo ? ' n° ' + esc(h.invoiceNo) : ''}</div>`).join('') : ''}`;
    const sigP = () => JSON.stringify([el('m').value, el('d').value, el('no').value, el('n').value]);
    const orig = sigP();
    current.dirty = () => canEdit && !!el('m') && sigP() !== orig;
    if (el('s')) guard(el('s'), async () => {
      const amt = r2(num(el('m').value)), date = el('d').value;
      if (amt <= 0 || !date) return alertBox('Le montant et la date sont obligatoires.');
      const data = { amount: amt, invoiceDate: date, invoiceNo: el('no').value.trim(), note: el('n').value.trim() };
      const b = writeBatch(db);
      if (!p) {
        if (data.invoiceNo && !(await checkInvoiceDup(sid, data.invoiceNo))) return;
        const ref = doc(collection(db, 'purchases'));
        b.set(ref, { ...data, supplierId: sid, supplierName: f.name, status: 'ok', createdAt: now(), createdBy: S.user.uid, createdByName: meName(), syncedAt: serverTimestamp(), history: [] });
        b.update(doc(db, 'suppliers', sid), { balance: increment(amt) });
        logJ(b, 'Achat fournisseur', `${f.name} — ${fmt(amt)} — facture du ${fday(date)}${data.invoiceNo ? ' n° ' + data.invoiceNo : ''}`, 'purchase', ref.id, [sid], null, data);
      } else {
        const d = r2(amt - p.amount);
        if (!(await confirmBox(`Ancien montant : ${fmt(p.amount)} → nouveau : ${fmt(amt)}${d ? `\nLe solde fournisseur sera ajusté de ${d > 0 ? '+' : ''}${fmt(d)}.` : ''}\nL'ancienne version restera visible.`, { title: 'Modifier cet achat ?', ok: 'Modifier' }))) return;
        const before = { amount: p.amount, invoiceDate: p.invoiceDate, invoiceNo: p.invoiceNo || '', note: p.note || '' };
        b.update(doc(db, 'purchases', p.id), { ...data, status: 'modified', modifiedAt: now(), modifiedBy: S.user.uid, modifiedByName: meName(), history: arrayUnion({ at: now(), byName: meName(), ...before }) });
        if (d) b.update(doc(db, 'suppliers', sid), { balance: increment(d) });
        logJ(b, 'Modification achat', `${f.name} — ${fmt(p.amount)} → ${fmt(amt)}`, 'purchase', p.id, [sid], before, data);
      }
      commit(b, 'Achat enregistré');
      current.dirty = null;
      nav('#/fournisseur/' + sid, { replace: true });
    });
    if (el('c')) guard(el('c'), async () => {
      if (!(await confirmBox(`Le solde dû au fournisseur diminuera de ${fmt(p.amount)}. L'achat restera visible avec la mention ANNULÉ.`, { title: 'Annuler cet achat ?', ok: 'Annuler l\'achat', cancel: 'Retour', danger: true }))) return;
      const b = writeBatch(db);
      b.update(doc(db, 'purchases', p.id), { status: 'cancelled', cancelledAt: now(), cancelledBy: S.user.uid, cancelledByName: meName() });
      b.update(doc(db, 'suppliers', p.supplierId), { balance: increment(-p.amount) });
      logJ(b, 'Annulation achat', `${f.name} — ${fmt(p.amount)} — facture du ${fday(p.invoiceDate)}`, 'purchase', p.id, [p.supplierId]);
      commit(b, 'Achat annulé');
      current.dirty = null;
      nav('#/fournisseur/' + p.supplierId, { replace: true });
    });
  };
  if (id) { loading(); getDoc(doc(db, 'purchases', id)).then(d => { if (!d.exists()) { $main.innerHTML = '<p>Achat introuvable.</p>'; return; } p = { id: d.id, ...d.data() }; draw(); }); }
  else draw();
  current.onState = () => { if (!el('m') && (p || !id)) draw(); };
}
async function checkInvoiceDup(sid, no) {
  try {
    const s = await getDocs(query(collection(db, 'purchases'), where('supplierId', '==', sid)));
    const dup = s.docs.map(d => d.data()).find(x => x.status !== 'cancelled' && (x.invoiceNo || '').toLowerCase() === no.toLowerCase());
    if (dup) return confirmBox(`La facture n° ${no} de ce fournisseur est déjà enregistrée (${fmt(dup.amount)}, le ${fday(dup.invoiceDate)}). L'enregistrer quand même ?`, { title: 'Doublon possible', ok: 'Enregistrer quand même' });
  } catch (e) {}
  return true;
}

// ---------- Produits ----------
function viewProducts() {
  let editId = null, f = '';
  const draw = () => {
    const e = editId ? S.products.find(p => p.id === editId) : null;
    $main.innerHTML = `<h2>Liste des produits</h2>
      <div class="card"><b>${e ? 'Modifier le produit' : 'Ajouter un produit'}</b>
        <label>Nom *</label><input id="n" value="${esc(e?.name || '')}">
        <div class="row"><div><label>Prix de vente *</label><input id="p" type="number" inputmode="decimal" step="any" value="${e?.price ?? ''}"></div>
          <div><label>Unité</label><select id="u"><option value="piece">pièce</option><option value="kg" ${e?.unit === 'kg' ? 'selected' : ''}>kg</option></select></div></div>
        <div class="actions"><button id="s">${e ? '💾 Enregistrer' : '+ Ajouter'}</button>${e ? `<button class="sec" id="x">Annuler</button>${isAdmin() ? '<button class="danger" id="del">Supprimer</button>' : ''}` : ''}</div></div>
      <input id="f" type="search" placeholder="🔍 Rechercher un produit" value="${esc(f)}">
      <div class="list" id="ls" style="margin-top:10px"></div>`;
    const drawList = () => {
      el('ls').innerHTML = S.products.filter(p => match(p.name, f)).map(p => `<a href="javascript:void 0" data-e="${p.id}">
        <span>${esc(p.name)}</span><span class="amt">${fmt(p.price)} / ${unitShort(p.unit)}</span></a>`).join('') || '<p class="muted">Aucun produit.</p>';
      $main.querySelectorAll('[data-e]').forEach(a => a.onclick = () => { editId = a.dataset.e; draw(); scrollTo(0, 0); });
    };
    drawList();
    el('f').oninput = ev => { f = ev.target.value; drawList(); };
    guard(el('s'), async () => {
      const name = el('n').value.trim(), price = r2(num(el('p').value)), unit = el('u').value;
      if (!name) return alertBox('Le nom est obligatoire.');
      if (!e && S.products.some(p => p.name.trim().toLowerCase() === name.toLowerCase())) return alertBox('Ce produit existe déjà dans la liste.');
      const b = writeBatch(db), ref = e ? doc(db, 'products', e.id) : doc(collection(db, 'products'));
      b.set(ref, { name, price, unit, updatedAt: now(), updatedByName: meName() }, { merge: true });
      logJ(b, e ? 'Modification produit' : 'Création produit', `${name} — ${fmt(price)} / ${unitShort(unit)}${e && e.price !== price ? ` (avant ${fmt(e.price)})` : ''}`, 'product', ref.id, [],
        e ? { name: e.name, price: e.price, unit: e.unit } : null, { name, price, unit });
      commit(b, 'Produit enregistré'); editId = null; draw();
    });
    if (e) {
      el('x').onclick = () => { editId = null; draw(); };
      if (el('del')) guard(el('del'), async () => {
        if (!(await confirmBox(`Supprimer « ${e.name} » de la liste ?\nLes bons déjà faits ne sont pas touchés.`, { ok: 'Supprimer', danger: true }))) return;
        const b = writeBatch(db); b.delete(doc(db, 'products', e.id));
        logJ(b, 'Suppression produit', `${e.name} — ${fmt(e.price)}`, 'product', e.id, [], { name: e.name, price: e.price, unit: e.unit });
        commit(b, 'Produit supprimé'); editId = null; draw();
      });
    }
  };
  draw();
  current.onState = () => { if (!editId && !el('n')?.value && document.activeElement?.id !== 'f') draw(); };
}

// ---------- Menu « Plus » ----------
function viewMore() {
  const waiting = S.users.filter(u => !u.active).length;
  $main.innerHTML = `<h2>Menu</h2><div class="list">
    <a href="#/bons"><span>🧾 Tous les bons de vente</span><span>›</span></a>
    <a href="#/produits"><span>📋 Liste des produits</span><span>›</span></a>
    <a href="#/config"><span>⚙️ Configuration</span><span>›</span></a></div>
    ${isAdmin() ? `<h3>Administration</h3><div class="list">
    <a href="#/utilisateurs"><span>👥 Utilisateurs ${waiting ? `<b class="dot">${waiting}</b>` : ''}</span><span>›</span></a>
    <a href="#/journal"><span>🕓 Journal d'activité</span><span>›</span></a>
    <a href="#/verification"><span>🔍 Vérifier les soldes</span><span>›</span></a>
    <a href="#/sauvegarde"><span>💾 Sauvegarde / export Excel</span><span>›</span></a></div>` : ''}
    <div class="list" style="margin-top:16px"><a href="javascript:void 0" id="out"><span>🚪 Déconnexion</span><span class="sub">${esc(S.user.email)}</span></a></div>
    <p class="muted center small-t">Vente Mobile v${VERSION} · ${esc(meName())} (${isAdmin() ? 'administrateur' : 'vendeur'})</p>`;
  el('out').onclick = async () => {
    if (pending && !(await confirmBox(`${pending} opération(s) ne sont pas encore envoyées. Elles seront envoyées à la prochaine connexion de ce compte sur ce téléphone. Se déconnecter quand même ?`, { danger: true, ok: 'Se déconnecter' }))) return;
    if (!pending && !(await confirmBox('Se déconnecter ?', { ok: 'Se déconnecter' }))) return;
    signOut(auth);
  };
}

// ---------- Configuration ----------
function viewConfig() {
  const draw = () => {
    const st = S.settings, me = S.me, pc = PC(), adm = isAdmin(), dis = adm ? '' : 'disabled';
    $main.innerHTML = `<h2>Configuration</h2>
      <div class="card"><b>🏢 Entreprise (en-tête et pied du bon)</b> ${adm ? '' : '<span class="muted small-t">— modifiable par l\'administrateur</span>'}
        <label>Logo</label>
        <div class="row"><img id="lg" class="logo-prev" src="${esc(st.logo || 'icons/icon-192.png')}" alt="">
          ${adm ? `<label class="btn sec fit" style="margin:0">Choisir…<input type="file" id="lf" accept="image/*" hidden></label>${st.logo ? '<button class="sec fit" id="lx">Retirer</button>' : ''}` : ''}</div>
        <label class="chk"><input type="checkbox" id="pl" ${st.printLogo ? 'checked' : ''} ${dis}> Imprimer le logo sur les bons</label>
        <label>Nom de l'entreprise / du vendeur</label><input id="cn" value="${esc(st.companyName || '')}" ${dis}>
        <label>Lignes d'en-tête (adresse, téléphone…) — une par ligne</label><textarea id="hd" ${dis}>${esc(st.header || '')}</textarea>
        <label>Pied du bon</label><textarea id="ft" ${dis}>${esc(st.footer || '')}</textarea>
        ${adm ? '<div class="actions"><button id="s1">💾 Enregistrer</button></div>' : ''}</div>

      <div class="card"><b>🖨️ Imprimante (ce téléphone)</b>
        <label>Mode d'impression</label><select id="pm">
          <option value="ble" ${pc.mode === 'ble' ? 'selected' : ''}>Bluetooth direct (recommandé)</option>
          <option value="rawbt" ${pc.mode === 'rawbt' ? 'selected' : ''}>Via l'application RawBT</option></select>
        <div id="blebox" ${pc.mode === 'ble' ? '' : 'hidden'}>
          <p class="small-t">Imprimante : <b>${esc(printerName() || 'aucune')}</b></p>
          <div class="actions"><button class="sec" id="pc">🔗 ${printerName() ? 'Changer d\'imprimante' : 'Choisir l\'imprimante'}</button>${printerName() ? '<button class="sec" id="pf">Oublier</button>' : ''}</div></div>
        <div class="row"><div><label>Caractères / ligne</label><select id="w">${[32, 42, 48].map(n => `<option ${+pc.width === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
          <div><label>Lignes vides à la fin</label><input id="fe" type="number" min="0" max="10" value="${pc.feed}"></div></div>
        <div class="row"><div><label>Accents (é, è, à…)</label><select id="cp">
          ${[['none', 'Sans accents (sûr)'], ['0', 'Table PC437'], ['2', 'Table PC850'], ['19', 'Table PC858']].map(([v, l]) => `<option value="${v}" ${pc.codepage === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
          <div><label>Taille des paquets</label><select id="ck">${[20, 50, 100, 180].map(n => `<option ${+pc.chunk === n ? 'selected' : ''}>${n}</option>`).join('')}</select></div></div>
        <p class="muted small-t">Si l'impression est coupée ou incomplète, gardez « 20 ». Si elle est lente, essayez 100.</p>
        <div class="actions"><button class="sec" id="test">🧪 Ticket de test</button></div></div>

      <div class="card"><b>🎨 Apparence (ce téléphone)</b>
        <div class="tabs" style="margin-top:8px">${[['auto', 'Automatique'], ['light', 'Clair'], ['dark', 'Sombre']].map(([v, l]) => `<button data-th="${v}" class="${(localStorage.getItem('theme') || 'auto') === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>

      <div class="card"><b>🔒 Code PIN (ce téléphone)</b>
        <p class="small-t muted">Demandé à l'ouverture et après une absence. Utile si le téléphone est perdu ou prêté.</p>
        ${pinIsSet() ? `<div class="row"><div><label>Verrouiller après</label><select id="lm">${[1, 5, 15, 30, 60].map(n => `<option value="${n}" ${(+localStorage.getItem('lockMin') || 5) === n ? 'selected' : ''}>${n} min</option>`).join('')}</select></div></div>
          <div class="actions"><button class="sec" id="pinch">Changer le code</button><button class="sec" id="pinrm">Supprimer le code</button></div>`
        : '<div class="actions"><button class="sec" id="pinch">Définir un code PIN</button></div>'}</div>

      <div class="card"><b>👤 Mon profil</b> <span class="muted small-t">${esc(S.user.email)}</span>
        <label>Nom du vendeur (imprimé sur les bons)</label><input id="mn" value="${esc(me.name || '')}">
        <label>Préfixe des numéros (ex. K → bons K-0001, reçus KR-0001)</label><input id="mp" value="${esc(me.prefix || '')}" maxlength="3">
        <p class="muted small-t">Dernier bon : n° ${me.bonCounter || 0} · dernier reçu : n° ${me.recuCounter || 0}</p>
        <div class="actions"><button id="s2">💾 Enregistrer</button></div></div>`;

    // Entreprise
    if (adm) {
      el('lf').onchange = async e => {
        const f = e.target.files[0]; if (!f) return;
        try { el('lg').src = await resizeImage(f, 300); el('lg').dataset.changed = '1'; toast('Logo prêt — pensez à Enregistrer'); }
        catch (er) { alertBox('Image illisible.'); }
      };
      if (el('lx')) el('lx').onclick = () => { el('lg').src = 'icons/icon-192.png'; el('lg').dataset.changed = 'rm'; };
      guard(el('s1'), () => {
        const v = { companyName: el('cn').value.trim(), header: el('hd').value, footer: el('ft').value, printLogo: el('pl').checked };
        if (el('lg').dataset.changed === '1') v.logo = el('lg').src;
        if (el('lg').dataset.changed === 'rm') v.logo = '';
        const b = writeBatch(db); b.set(doc(db, 'settings', 'general'), v, { merge: true });
        logJ(b, 'Configuration', 'En-tête / pied / logo du bon modifiés', 'settings', 'general', [], null, { companyName: v.companyName });
        commit(b, 'Configuration enregistrée');
      });
    }
    // Imprimante
    const savePC = () => setPC({ mode: el('pm').value, width: +el('w').value, feed: Math.max(0, Math.min(10, +el('fe').value || 0)), codepage: el('cp').value, chunk: +el('ck').value });
    ['w', 'fe', 'cp', 'ck'].forEach(i => el(i).onchange = () => { savePC(); toast('Réglage enregistré'); });
    el('pm').onchange = () => { savePC(); draw(); };
    if (el('pc')) el('pc').onclick = async () => {
      try { const n = await connectPrinter(true); toast('Imprimante connectée : ' + n); draw(); }
      catch (e) { if (e.name !== 'NotFoundError') alertBox('Connexion impossible : ' + e.message); }
    };
    if (el('pf')) el('pf').onclick = () => { forgetPrinter(); draw(); };
    el('test').onclick = () => {
      const keep = S.settings;
      if (adm) S.settings = { ...keep, companyName: el('cn').value.trim(), header: el('hd').value, footer: el('ft').value, printLogo: el('pl').checked, logo: el('lg').dataset.changed ? (el('lg').dataset.changed === 'rm' ? '' : el('lg').src) : keep.logo };
      const L = testTicket(); S.settings = keep;
      printTicket(L);
    };
    // Thème
    $main.querySelectorAll('[data-th]').forEach(b => b.onclick = () => { localStorage.setItem('theme', b.dataset.th); applyTheme(); draw(); });
    // PIN
    if (el('lm')) el('lm').onchange = e => localStorage.setItem('lockMin', e.target.value);
    el('pinch').onclick = () => setPin(draw);
    if (el('pinrm')) el('pinrm').onclick = async () => { if (await confirmBox('Supprimer le code PIN de ce téléphone ?')) { localStorage.removeItem(pinKey()); draw(); } };
    // Profil
    guard(el('s2'), async () => {
      const prefix = el('mp').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (!prefix) return alertBox('Le préfixe est obligatoire.');
      const other = S.users.find(u => u.id !== S.user.uid && (u.prefix || '').toUpperCase() === prefix);
      if (other) return alertBox(`Le préfixe « ${prefix} » est déjà utilisé par ${other.name}. Choisissez-en un autre pour éviter des numéros de bons identiques.`);
      const b = writeBatch(db); b.update(doc(db, 'users', S.user.uid), { name: el('mn').value.trim(), prefix });
      commit(b, 'Profil enregistré');
    });
  };
  draw();
}
function resizeImage(file, maxW) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => { const i = new Image(); i.onload = () => {
      const w = Math.min(maxW, i.width), h = Math.round(i.height * w / i.width);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.drawImage(i, 0, 0, w, h);
      res(c.toDataURL('image/png'));
    }; i.onerror = rej; i.src = r.result; };
    r.onerror = rej; r.readAsDataURL(file);
  });
}
function setPin(done) {
  const sh = sheet('Code PIN', `<p>Choisissez un code à 4 chiffres.</p>
    <input id="p1" type="password" inputmode="numeric" maxlength="4" placeholder="Nouveau code">
    <input id="p2" type="password" inputmode="numeric" maxlength="4" placeholder="Confirmer le code" style="margin-top:8px">
    <div class="actions"><button id="pok">Enregistrer</button></div>`);
  sh.root.querySelector('#pok').onclick = async () => {
    const a = sh.root.querySelector('#p1').value, b = sh.root.querySelector('#p2').value;
    if (!/^\d{4}$/.test(a)) return alertBox('Le code doit contenir 4 chiffres.');
    if (a !== b) return alertBox('Les deux codes sont différents.');
    localStorage.setItem(pinKey(), await sha(S.user.uid + ':' + a));
    sh.close(); toast('Code PIN enregistré'); done();
  };
}

// ---------- Administration : utilisateurs ----------
function viewUsers() {
  if (!isAdmin()) return viewDash();
  const draw = () => {
    $main.innerHTML = `<h2>Utilisateurs</h2>
      <p class="muted small-t">Les comptes se créent dans la console Firebase (Authentication → Ajouter un utilisateur). Le vendeur se connecte une première fois, puis vous l'activez ici.</p>
      <div class="list">${S.users.slice().sort((a, b) => (a.active === b.active ? 0 : a.active ? 1 : -1)).map(u => `<a href="javascript:void 0" data-u="${u.id}">
        <div>${esc(u.name || u.email)} ${u.role === 'admin' ? '<span class="badge">Admin</span>' : ''} ${u.active ? '' : '<span class="badge ann">En attente / désactivé</span>'}
        <div class="sub">${esc(u.email || '')} · préfixe ${esc(u.prefix || '?')}</div></div><span>›</span></a>`).join('')}</div>`;
    $main.querySelectorAll('[data-u]').forEach(a => a.onclick = () => editUser(S.users.find(u => u.id === a.dataset.u)));
  };
  draw(); current.onState = draw;
}
function editUser(u) {
  const self = u.id === S.user.uid;
  const sh = sheet(u.name || u.email, `
    <p class="small-t">${esc(u.email || '')}</p>
    <label class="chk"><input type="checkbox" id="ua" ${u.active ? 'checked' : ''} ${self ? 'disabled' : ''}> Compte actif (peut utiliser l'application)</label>
    <label>Rôle</label><select id="ur" ${self ? 'disabled' : ''}><option value="vendeur">Vendeur</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>Administrateur</option></select>
    <label>Préfixe des numéros</label><input id="up" value="${esc(u.prefix || '')}" maxlength="3">
    ${self ? '<p class="muted small-t">Vous ne pouvez pas désactiver ni rétrograder votre propre compte.</p>' : ''}
    <p class="muted small-t">Vendeur : ventes, versements, achats, clients, produits ; modifie ses propres bons.<br>Administrateur : en plus, annulations, soldes de départ, configuration, utilisateurs, journal, sauvegardes.</p>
    <div class="actions"><button id="us">💾 Enregistrer</button></div>`);
  sh.root.querySelector('#us').onclick = async () => {
    const active = sh.root.querySelector('#ua').checked, role = sh.root.querySelector('#ur').value;
    const prefix = sh.root.querySelector('#up').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!prefix) return alertBox('Préfixe obligatoire.');
    if (S.users.some(x => x.id !== u.id && (x.prefix || '').toUpperCase() === prefix)) return alertBox('Ce préfixe est déjà utilisé.');
    if (role === 'admin' && u.role !== 'admin' && !(await confirmBox(`Donner les droits d'administrateur à ${u.name || u.email} ?`))) return;
    const b = writeBatch(db);
    b.update(doc(db, 'users', u.id), { active, role, prefix });
    logJ(b, 'Utilisateur', `${u.email} — ${active ? 'actif' : 'désactivé'}, ${role}, préfixe ${prefix}`, 'user', u.id, [], { active: !!u.active, role: u.role, prefix: u.prefix || '' }, { active, role, prefix });
    commit(b, 'Utilisateur mis à jour'); sh.close();
  };
}

// ---------- Administration : journal ----------
let jPeriod = 'day';
function viewJournal() {
  if (!isAdmin()) return viewDash();
  let rows = [], f = '';
  const sub = () => {
    stop(viewSubs);
    const [a, b] = periodRange(jPeriod);
    viewSubs.push(onSnapshot(query(collection(db, 'journal'), where('atDevice', '>=', Timestamp.fromDate(a)), where('atDevice', '<', Timestamp.fromDate(b))), s => {
      rows = s.docs.map(d => ({ id: d.id, ...d.data() })).sort((x, y) => ms(y.atDevice) - ms(x.atDevice)); draw();
    }));
  };
  const draw = () => {
    const vis = rows.filter(j => match(j.action + ' ' + j.label + ' ' + j.byName, f));
    $main.innerHTML = `<h2>Journal d'activité</h2>
      <div class="tabs">${Object.entries(PERIODS).filter(([k]) => k !== 'custom').map(([k, v]) => `<button data-p="${k}" class="${k === jPeriod ? 'on' : ''}">${v}</button>`).join('')}</div>
      <input id="f" type="search" placeholder="🔍 Filtrer (utilisateur, client, n° de bon…)" value="${esc(f)}">
      <div class="list" style="margin-top:10px">${vis.map(j => `<a href="javascript:void 0" data-j="${j.id}" class="col"><div><b>${esc(j.action)}</b> <span class="sub">${fdt(j.atDevice)} · ${esc(j.byName)}</span></div><div class="sub">${esc(j.label)}</div></a>`).join('') || '<p class="muted">Aucune entrée.</p>'}</div>`;
    $main.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { jPeriod = b.dataset.p; sub(); });
    el('f').oninput = e => { f = e.target.value; const p = e.target.selectionStart; draw(); el('f').focus(); el('f').setSelectionRange(p, p); };
    $main.querySelectorAll('[data-j]').forEach(a => a.onclick = () => {
      const j = rows.find(x => x.id === a.dataset.j);
      const show = v => v ? `<pre class="ticket">${esc(JSON.stringify(v, (k, x) => (x && typeof x.toDate === 'function') ? fdt(x) : x, 1))}</pre>` : '<p class="muted">—</p>';
      sheet(j.action, `<p>${esc(j.label)}</p><p class="small-t muted">Par ${esc(j.byName)} · sur le téléphone : ${fdt(j.atDevice)} · serveur : ${j.at ? fdt(j.at) : 'en attente'}</p>
        <h3>Avant</h3>${show(j.before)}<h3>Après</h3>${show(j.after)}`);
    });
  };
  sub(); draw();
}

// ---------- Administration : vérification des soldes ----------
function viewCheck() {
  if (!isAdmin()) return viewDash();
  $main.innerHTML = `<h2>Vérifier les soldes</h2>
    <p class="small-t">Recalcule chaque solde à partir du solde de départ et de toutes les opérations, et le compare au solde enregistré.</p>
    <p class="muted small-t">À lancer avec Internet, quand tous les téléphones ont synchronisé (sinon des écarts temporaires peuvent apparaître).</p>
    <div class="actions"><button id="go">🔍 Lancer la vérification</button></div><div id="res"></div>`;
  guard(el('go'), async () => {
    if (!navigator.onLine) return alertBox('Internet est nécessaire pour la vérification.');
    el('res').innerHTML = '<p class="muted">Calcul en cours…</p>';
    try {
      const get = async c => (await getDocs(collection(db, c))).docs.map(d => d.data()).filter(x => x.status !== 'cancelled');
      const [sales, cp, pur, sp] = await Promise.all(['sales', 'clientPayments', 'purchases', 'supplierPayments'].map(get));
      const out = [];
      for (const c of S.clients) {
        const calc = r2((c.openingBalance || 0) + sumBy(sales.filter(s => s.clientId === c.id), s => s.total - (s.paid || 0)) - sumBy(cp.filter(p => p.clientId === c.id), p => p.amount));
        if (Math.abs(calc - (c.balance || 0)) > 0.009) out.push({ col: 'clients', kind: 'client', x: c, calc });
      }
      for (const f of S.suppliers) {
        const calc = r2((f.openingBalance || 0) + sumBy(pur.filter(p => p.supplierId === f.id), p => p.amount) - sumBy(sp.filter(p => p.supplierId === f.id), p => p.amount));
        if (Math.abs(calc - (f.balance || 0)) > 0.009) out.push({ col: 'suppliers', kind: 'supplier', x: f, calc });
      }
      el('res').innerHTML = out.length ? `<p class="pos"><b>${out.length} écart(s) trouvé(s)</b></p><div class="list">${out.map((o, i) => `<div class="it"><div>${esc(o.x.name)}<div class="sub">Enregistré ${fmt(o.x.balance || 0)} · recalculé ${fmt(o.calc)}</div></div><button class="small" data-fix="${i}">Corriger</button></div>`).join('')}</div>`
        : '<p class="neg"><b>✓ Tous les soldes sont justes.</b></p>';
      el('res').querySelectorAll('[data-fix]').forEach(b => guard(b, async () => {
        const o = out[+b.dataset.fix];
        if (!(await confirmBox(`Remplacer le solde de ${o.x.name} (${fmt(o.x.balance || 0)}) par le solde recalculé (${fmt(o.calc)}) ?`, { ok: 'Corriger' }))) return;
        const bt = writeBatch(db);
        bt.update(doc(db, o.col, o.x.id), { balance: o.calc });
        logJ(bt, 'Correction de solde', `${o.x.name} — ${fmt(o.x.balance || 0)} → ${fmt(o.calc)}`, o.kind, o.x.id, [], { balance: o.x.balance || 0 }, { balance: o.calc });
        commit(bt, 'Solde corrigé'); b.replaceWith(Object.assign(document.createElement('span'), { className: 'neg', textContent: '✓ corrigé' }));
      }));
    } catch (e) { el('res').innerHTML = `<p class="pos">Erreur : ${esc(e.message)}</p>`; }
  });
}

// ---------- Administration : sauvegarde ----------
function viewBackup() {
  if (!isAdmin()) return viewDash();
  const last = localStorage.getItem('lastBackup');
  $main.innerHTML = `<h2>Sauvegarde</h2>
    <p class="small-t">L'offre gratuite de Firebase ne fait pas de sauvegarde automatique. Exportez vos données <b>au moins une fois par semaine</b> et gardez le fichier en lieu sûr (Google Drive, e-mail…).</p>
    <p class="muted small-t">Dernière sauvegarde sur ce téléphone : ${last ? fdt(new Date(+last)) : 'jamais'}</p>
    <div class="card"><b>📊 Export Excel</b><p class="small-t muted">Clients, fournisseurs, produits, bons et leurs lignes, versements, achats, journal — une feuille par élément.</p>
      <div class="actions"><button id="xl">Télécharger le fichier Excel</button></div></div>
    <div class="card"><b>🗄️ Sauvegarde complète</b><p class="small-t muted">Fichier .json contenant toutes les données, utilisable pour une restauration.</p>
      <div class="actions"><button class="sec" id="js">Télécharger la sauvegarde</button></div></div>`;
  const run = fn => async () => {
    if (!navigator.onLine) return alertBox('Internet est nécessaire pour une sauvegarde complète.');
    toast('Préparation…');
    try { await fn(); localStorage.setItem('lastBackup', Date.now()); toast('Fichier téléchargé'); }
    catch (e) { alertBox('Erreur : ' + e.message); }
  };
  guard(el('xl'), run(exportExcel)); guard(el('js'), run(exportJSON));
}
