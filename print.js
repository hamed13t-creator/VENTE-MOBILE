// Impression : mise en forme des tickets, ESC/POS, Bluetooth direct (BLE), RawBT, image à partager
import { S, fmt, fq, fdt, fd, unitShort, itemStats } from './util.js';
import { toast, alertBox } from './ui.js';

// ---------- Mise en forme (texte 58 mm) ----------
// Réglages d'impression propres à chaque téléphone
export const PC = () => { let c = {}; try { c = JSON.parse(localStorage.getItem('printCfg') || '{}'); } catch (e) {} return { mode: 'ble', width: 32, codepage: 'none', feed: 3, chunk: 20, ...c }; };
export const setPC = o => localStorage.setItem('printCfg', JSON.stringify({ ...PC(), ...o }));
export const W = () => +PC().width || 32;
export function lr(l, r, w = W()) {
  l = String(l); r = String(r);
  const max = w - r.length - 1;
  if (l.length > max) l = l.slice(0, Math.max(0, max));
  return l + ' '.repeat(Math.max(1, w - l.length - r.length)) + r;
}
export function wrap(s, w = W()) {
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
  if (st.logo && st.printLogo) L.push({ logo: true });
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
export function bonTicket(s) {
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
  const st = itemStats(s.items);
  L.push({ t: lr('Nombre d\'articles', String(st.lines)) });
  if (st.qtyLabel) L.push({ t: lr('Quantité totale', st.qtyLabel) });
  L.push(sep());
  L.push({ t: lr('TOTAL BON', fmt(s.total)), b: true });
  L.push({ t: lr('Ancien solde', fmt(s.prevBalance)) });
  L.push({ t: lr('Versement', fmt(s.paid)) });
  L.push({ t: lr('NOUVEAU SOLDE', fmt(s.newBalance)), b: true });
  return tFooter(L);
}
export function recuTicket(p) {
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
// Relevé de compte : rows = [{date, label, amount(+/-), balance}]
export function releveTicket(title, name, rows, final) {
  const L = tHeader();
  L.push({ t: title, b: true, a: 'c' });
  L.push({ t: name, b: true });
  L.push({ t: 'Édité le ' + fdt(new Date()) });
  L.push(sep());
  for (const r of rows) {
    L.push({ t: (r.date ? fd(r.date).slice(0, 6) + fd(r.date).slice(8) + ' ' : '') + r.label });
    L.push({ t: lr('  ' + (r.amount === null ? '' : (r.amount >= 0 ? '+' : '-') + fmt(Math.abs(r.amount))), fmt(r.balance)) });
  }
  L.push(sep());
  L.push({ t: lr('SOLDE', fmt(final)), b: true });
  return tFooter(L);
}
export function testTicket() {
  const L = tHeader();
  L.push({ t: 'TICKET DE TEST', a: 'c', b: true }, { t: 'Accents : é è ê à ç ù ô É' }, { t: lr('Article test', fmt(1234.5)) });
  return tFooter(L);
}
// Aperçu texte (à l'écran)
export function ticketText(L) {
  const w = W();
  return L.filter(l => !l.logo).map(l => {
    const t = l.big ? l.t.split('').join(' ') : l.t;
    if (l.a !== 'c') return t;
    return ' '.repeat(Math.max(0, Math.floor((w - t.length) / 2))) + t;
  }).join('\n');
}

// ---------- Encodage ESC/POS ----------
const CP_LOWER = { 'é': 0x82, 'è': 0x8A, 'ê': 0x88, 'ë': 0x89, 'à': 0x85, 'â': 0x83, 'ä': 0x84, 'ç': 0x87, 'ù': 0x97, 'û': 0x96, 'ü': 0x81, 'ô': 0x93, 'ö': 0x94, 'î': 0x8C, 'ï': 0x8B, 'É': 0x90, 'Ç': 0x80, '°': 0xF8 };
const CP850_UP = { 'À': 0xB7, 'Â': 0xB6, 'È': 0xD4, 'Ê': 0xD2, 'Ë': 0xD3, 'Î': 0xD7, 'Ï': 0xD8, 'Ô': 0xE2, 'Ù': 0xEB, 'Û': 0xEA };
const strip = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/°/g, 'o');
export function encodeText(s, cp) {
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
const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
// Logo -> image 1 bit (commande GS v 0)
async function logoRaster() {
  if (!S.settings.logo) return null;
  const img = await loadImg(S.settings.logo);
  const w = Math.min(W() >= 42 ? 320 : 240, img.width * 4);
  const h = Math.round(img.height * w / img.width);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.drawImage(img, 0, 0, w, h);
  const px = x.getImageData(0, 0, w, h).data, bw = Math.ceil(w / 8);
  const out = [0x1D, 0x76, 0x30, 0x00, bw & 255, bw >> 8, h & 255, h >> 8];
  for (let y = 0; y < h; y++) for (let b = 0; b < bw; b++) {
    let v = 0;
    for (let k = 0; k < 8; k++) {
      const xx = b * 8 + k; if (xx >= w) continue;
      const i = (y * w + xx) * 4, lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      if (px[i + 3] > 128 && lum < 140) v |= 0x80 >> k;
    }
    out.push(v);
  }
  return out;
}
export async function escpos(L) {
  const cp = PC().codepage || 'none';
  const out = [0x1B, 0x40];
  if (cp !== 'none') out.push(0x1B, 0x74, +cp);
  for (const l of L) {
    if (l.logo) {
      try { const r = await logoRaster(); if (r) { out.push(0x1B, 0x61, 1); for (const b of r) out.push(b); out.push(0x0A); } } catch (e) { /* logo ignoré */ }
      continue;
    }
    out.push(0x1B, 0x61, l.a === 'c' ? 1 : 0, 0x1B, 0x45, l.b ? 1 : 0, 0x1D, 0x21, l.big ? 0x11 : 0);
    for (const b of encodeText(l.t, cp)) out.push(b);
    out.push(0x0A);
  }
  out.push(0x1B, 0x45, 0, 0x1D, 0x21, 0, 0x1B, 0x61, 0);
  for (let i = 0; i < (+PC().feed || 0); i++) out.push(0x0A);
  return new Uint8Array(out);
}

// ---------- Imprimante Bluetooth directe (BLE, depuis Chrome) ----------
// Services GATT utilisés par la plupart des imprimantes thermiques 58 mm
const SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb', 'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000ffe0-0000-1000-8000-00805f9b34fb', '0000fee7-0000-1000-8000-00805f9b34fb',
  '0000ae30-0000-1000-8000-00805f9b34fb', '0000ae00-0000-1000-8000-00805f9b34fb',
  '0000ff12-0000-1000-8000-00805f9b34fb', '0000fff0-0000-1000-8000-00805f9b34fb'
];
let device = null, chr = null;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const withTimeout = (p, ms, msg) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);
function dropConnection() { try { device?.gatt?.disconnect(); } catch (e) {} chr = null; }
export const printMode = () => PC().mode;
export const printerName = () => localStorage.getItem('printerName') || '';

async function pickDevice() {
  device = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: SERVICES });
  localStorage.setItem('printerId', device.id);
  localStorage.setItem('printerName', device.name || 'Imprimante');
  return device;
}
async function findChar(dev) {
  const server = await withTimeout(dev.gatt.connect(), 15000, 'l\'imprimante ne répond pas (connexion).');
  const services = await server.getPrimaryServices();
  for (const s of services) {
    for (const c of await s.getCharacteristics()) {
      if (c.properties.writeWithoutResponse || c.properties.write) return c;
    }
  }
  throw new Error('Cet appareil ne propose pas de canal d\'impression.');
}
async function getChar() {
  if (chr && device?.gatt?.connected) return chr;
  if (!device && navigator.bluetooth.getDevices) {
    // imprimante déjà autorisée lors d'une session précédente
    try { const ds = await navigator.bluetooth.getDevices(); device = ds.find(d => d.id === localStorage.getItem('printerId')) || null; } catch (e) { device = null; }
  }
  if (!device) await pickDevice();
  device.addEventListener('gattserverdisconnected', () => { chr = null; });
  try { chr = await findChar(device); }
  catch (e) {
    if (e.message?.includes('canal')) throw e;
    // appareil mémorisé injoignable : on redemande le choix
    await pickDevice(); device.addEventListener('gattserverdisconnected', () => { chr = null; });
    chr = await findChar(device);
  }
  return chr;
}
export async function connectPrinter(forceChoose = false) {
  if (!navigator.bluetooth) throw new Error('Bluetooth non disponible dans ce navigateur (utilisez Chrome sur Android).');
  if (forceChoose) { try { device?.gatt?.disconnect(); } catch (e) {} device = null; chr = null; await pickDevice(); }
  await getChar();
  return printerName();
}
export function forgetPrinter() {
  try { device?.gatt?.disconnect(); } catch (e) {}
  device = null; chr = null;
  localStorage.removeItem('printerId'); localStorage.removeItem('printerName');
}
async function writeBle(bytes) {
  const c = await getChar();
  const size = +PC().chunk || 20;
  for (let i = 0; i < bytes.length; i += size) {
    const part = bytes.slice(i, i + size);
    if (c.properties.writeWithoutResponse) { await c.writeValueWithoutResponse(part); await sleep(12); }
    else await c.writeValueWithResponse(part);
  }
}
function rawbt(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 4096) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 4096));
  location.href = 'intent:base64,' + btoa(bin) + '#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;';
}
// Point d'entrée unique. À appeler directement depuis un clic (le choix Bluetooth l'exige).
let busy = false;
export async function printTicket(L) {
  if (busy) return;
  busy = true;
  try {
    if (printMode() === 'rawbt') { rawbt(await escpos(L)); return; }
    if (!navigator.bluetooth) { await alertBox('Le Bluetooth direct n\'est pas disponible ici. Ouvrez l\'application dans Chrome sur Android, ou choisissez RawBT dans Configuration.', 'Impression'); return; }
    // la connexion (et le choix de l'imprimante) doit partir du clic : on la lance avant tout calcul
    const ready = getChar();
    const bytes = await escpos(L);
    await ready;
    toast('Impression en cours…');
    await withTimeout(writeBle(bytes), 20000 + bytes.length * 3, 'l\'envoi au ticket a été interrompu.');
    toast('Imprimé ✓');
  } catch (e) {
    dropConnection();
    if (e.name === 'NotFoundError') toast('Aucune imprimante choisie.');
    else await alertBox('Impression impossible : ' + e.message + '\n\nVérifiez que l\'imprimante est allumée, proche, et qu\'elle n\'est pas connectée à un autre téléphone (ou à RawBT). Puis réessayez.', 'Impression');
  } finally { busy = false; }
}

// ---------- Image du ticket (partage WhatsApp…) ----------
export async function ticketImage(L) {
  const w = W(), fs = 22, pad = 16;
  const c = document.createElement('canvas'), x = c.getContext('2d');
  x.font = `${fs}px monospace`;
  const cw = x.measureText('M').width, lh = Math.round(fs * 1.35);
  let logo = null;
  if (L.some(l => l.logo) && S.settings.logo) { try { logo = await loadImg(S.settings.logo); } catch (e) {} }
  const logoH = logo ? Math.round(Math.min(160, logo.height * 200 / logo.width)) : 0;
  const lines = L.filter(l => !l.logo);
  c.width = Math.ceil(w * cw + pad * 2);
  c.height = pad * 2 + logoH + (logo ? 10 : 0) + lines.reduce((s, l) => s + (l.big ? lh * 2 : lh), 0);
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  let y = pad;
  if (logo) { const lw = logo.width * logoH / logo.height; x.drawImage(logo, (c.width - lw) / 2, y, lw, logoH); y += logoH + 10; }
  x.fillStyle = '#000'; x.textBaseline = 'top';
  for (const l of lines) {
    const size = l.big ? fs * 2 : fs;
    x.font = `${l.b ? 'bold ' : ''}${size}px monospace`;
    const tw = x.measureText(l.t).width;
    x.fillText(l.t, l.a === 'c' ? (c.width - tw) / 2 : pad, y);
    y += l.big ? lh * 2 : lh;
  }
  return new Promise(res => c.toBlob(res, 'image/png'));
}
export async function shareTicket(L, name) {
  const blob = await ticketImage(L);
  const file = new File([blob], name.replace(/[^\w.-]+/g, '_') + '.png', { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); } catch (e) { /* partage annulé */ }
  } else {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
}
