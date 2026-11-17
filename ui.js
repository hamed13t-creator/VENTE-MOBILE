// Composants d'interface : notifications, fenêtres de confirmation, sélecteur avec recherche
import { esc, match } from './util.js';

const modals = []; // fenêtres ouvertes (le bouton Retour ferme la dernière)
export const hasModal = () => modals.length > 0;
export function closeTopModal() { const m = modals.pop(); if (m) m.close(true); }

export function toast(msg, ms = 2500) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), ms);
}

function overlay(html, cls = '') {
  const o = document.createElement('div');
  o.className = 'overlay ' + cls;
  o.innerHTML = html;
  document.body.appendChild(o);
  requestAnimationFrame(() => o.classList.add('show'));
  return o;
}
function removeOverlay(o) { o.classList.remove('show'); setTimeout(() => o.remove(), 200); }

// Fenêtre de confirmation : renvoie true/false
export function confirmBox(msg, { ok = 'Confirmer', cancel = 'Annuler', danger = false, title = '' } = {}) {
  return new Promise(res => {
    const o = overlay(`<div class="dialog">${title ? `<h3>${esc(title)}</h3>` : ''}<p class="pre">${esc(msg)}</p>
      <div class="dlg-actions">${cancel ? `<button class="sec" data-r="0">${esc(cancel)}</button>` : ''}<button class="${danger ? 'danger' : ''}" data-r="1">${esc(ok)}</button></div></div>`);
    const m = { close: (back) => { const i = modals.indexOf(m); if (i >= 0) modals.splice(i, 1); removeOverlay(o); res(false); } };
    modals.push(m);
    o.querySelectorAll('[data-r]').forEach(b => b.onclick = () => {
      const i = modals.indexOf(m); if (i >= 0) modals.splice(i, 1);
      removeOverlay(o); res(b.dataset.r === '1');
    });
  });
}
export const alertBox = (msg, title = '') => confirmBox(msg, { ok: 'OK', cancel: '', title });

// Sélecteur avec barre de recherche (feuille du bas)
// items: [{id, label, sub, right, search}] ; onPick(item) -> true pour fermer
export function picker({ title, items, onPick, extra, keepOpen = false, emptyText = 'Aucun résultat', onClose }) {
  const o = overlay(`<div class="sheet"><div class="sheet-head"><b>${esc(title)}</b><button class="sec small" data-x>Fermer</button></div>
    <input class="sheet-search" placeholder="🔍 Rechercher…" autocomplete="off">
    ${extra ? `<button class="sec" data-extra style="margin:6px 0">${esc(extra.label)}</button>` : ''}
    <div class="sheet-list list"></div></div>`, 'bottom');
  const list = o.querySelector('.sheet-list'), inp = o.querySelector('.sheet-search');
  const m = { close: () => { const i = modals.indexOf(m); if (i >= 0) modals.splice(i, 1); removeOverlay(o); onClose && onClose(); } };
  modals.push(m);
  const draw = () => {
    const q = inp.value.trim();
    const rows = items.filter(x => match((x.search || '') + ' ' + x.label, q)).slice(0, 150);
    list.innerHTML = rows.map(x => `<a data-id="${esc(x.id)}"><div>${esc(x.label)}${x.sub ? `<div class="sub">${esc(x.sub)}</div>` : ''}</div>
      ${x.right ? `<span class="amt">${esc(x.right)}</span>` : ''}${x.count ? `<span class="badge">×${x.count}</span>` : ''}</a>`).join('') || `<p class="muted center">${esc(emptyText)}</p>`;
    list.querySelectorAll('[data-id]').forEach(a => a.onclick = () => {
      const it = items.find(x => String(x.id) === a.dataset.id);
      const close = onPick(it);
      if (close || !keepOpen) m.close(); else draw();
    });
  };
  inp.oninput = draw;
  o.querySelector('[data-x]').onclick = () => m.close();
  o.addEventListener('click', e => { if (e.target === o) m.close(); });
  if (extra) o.querySelector('[data-extra]').onclick = () => { m.close(); extra.onClick(); };
  draw();
  setTimeout(() => inp.focus(), 250);
  return { refresh: draw, close: m.close };
}

// Ouvre un contenu HTML libre dans une fenêtre (ex. aperçu)
export function sheet(title, html) {
  const o = overlay(`<div class="sheet"><div class="sheet-head"><b>${esc(title)}</b><button class="sec small" data-x>Fermer</button></div>${html}</div>`, 'bottom');
  const m = { close: () => { const i = modals.indexOf(m); if (i >= 0) modals.splice(i, 1); removeOverlay(o); } };
  modals.push(m);
  o.querySelector('[data-x]').onclick = () => m.close();
  o.addEventListener('click', e => { if (e.target === o) m.close(); });
  return { root: o, close: m.close };
}

// Bouton protégé contre le double appui : désactivé pendant l'action
export function guard(btn, fn) {
  btn.onclick = async () => {
    if (btn.disabled) return;
    btn.disabled = true;
    try { await fn(); } finally { setTimeout(() => { if (btn.isConnected) btn.disabled = false; }, 800); }
  };
}
