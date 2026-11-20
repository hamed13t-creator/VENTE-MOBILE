// Sauvegarde : export Excel (.xlsx) et sauvegarde complète (.json)
import { db, collection, getDocs, doc, writeBatch, Timestamp } from './fb.js';
import { toDate, fdt, isoDay } from './util.js';

export const COLS = ['settings', 'users', 'products', 'clients', 'suppliers', 'sales', 'clientPayments', 'purchases', 'supplierPayments', 'journal'];

// Convertit les dates Firestore en { __ts: "ISO" } (récursif) pour pouvoir les restaurer
function plain(v) {
  if (v && typeof v.toDate === 'function') return { __ts: v.toDate().toISOString() };
  if (Array.isArray(v)) return v.map(plain);
  if (v && typeof v === 'object') { const o = {}; for (const k in v) o[k] = plain(v[k]); return o; }
  return v;
}
export async function loadAll() {
  const data = {};
  for (const c of COLS) {
    const s = await getDocs(collection(db, c));
    data[c] = s.docs.map(d => ({ id: d.id, ...d.data() }));
  }
  return data;
}
function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
export async function exportJSON() {
  const data = await loadAll();
  const out = { app: 'VenteMobile', format: 2, exportedAt: new Date().toISOString(), collections: {} };
  for (const c in data) out.collections[c] = data[c].map(plain);
  download(new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' }), `ventemobile-sauvegarde-${isoDay(new Date())}.json`);
}

// ---- Petit générateur .xlsx (zip sans compression) ----
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
function zip(files) {
  const enc = new TextEncoder(), parts = [], central = []; let off = 0;
  const u16 = n => [n & 255, (n >> 8) & 255], u32 = n => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  for (const [name, text] of files) {
    const nb = enc.encode(name), data = enc.encode(text), crc = crc32(data);
    const head = [...u32(0x04034b50), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nb.length), ...u16(0)];
    parts.push(new Uint8Array(head), nb, data);
    central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nb.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), nb);
    off += head.length + nb.length + data.length;
  }
  const csize = central.reduce((s, x) => s + x.length, 0);
  const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(csize), ...u32(off), ...u16(0)]);
  return new Blob([...parts, ...central, end], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
const xe = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
const colName = i => { let s = ''; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
function sheetXml(rows) {
  const body = rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
    const ref = colName(ci) + (ri + 1);
    if (typeof v === 'number' && isFinite(v)) return `<c r="${ref}"${ri === 0 ? ' s="1"' : ''}><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${ri === 0 ? ' s="1"' : ''}><is><t xml:space="preserve">${xe(v)}</t></is></c>`;
  }).join('')}</row>`).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${body}</sheetData></worksheet>`;
}
export function buildXlsx(sheets) { // sheets: [[nom, lignes]]
  const files = [
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map(([n], i) => `<sheet name="${xe(n).slice(0, 31)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`],
    ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`],
    ...sheets.map(([, rows], i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(rows)])
  ];
  return zip(files);
}
const st = s => s === 'cancelled' ? 'Annulé' : s === 'modified' ? 'Modifié' : 'OK';
export async function exportExcel() {
  const d = await loadAll();
  const sheets = [
    ['Clients', [['Nom', 'Téléphone', 'Adresse', 'Solde de départ', 'Solde actuel'], ...d.clients.map(c => [c.name, c.phone || '', c.address || '', c.openingBalance || 0, c.balance || 0])]],
    ['Fournisseurs', [['Nom', 'Téléphone', 'Adresse', 'Solde de départ', 'Solde dû'], ...d.suppliers.map(c => [c.name, c.phone || '', c.address || '', c.openingBalance || 0, c.balance || 0])]],
    ['Produits', [['Nom', 'Prix', 'Unité'], ...d.products.map(p => [p.name, p.price || 0, p.unit === 'kg' ? 'kg' : 'pièce'])]],
    ['Bons', [['N°', 'Date', 'Client', 'Vendeur', 'Total', 'Versé', 'Ancien solde', 'Nouveau solde', 'État'], ...d.sales.sort((a, b) => toDate(a.createdAt) - toDate(b.createdAt)).map(s => [s.number, fdt(s.createdAt), s.clientName, s.createdByName, s.total, s.paid || 0, s.prevBalance || 0, s.newBalance || 0, st(s.status)])]],
    ['Lignes des bons', [['N° bon', 'Date', 'Client', 'Article', 'Quantité', 'Unité', 'Prix', 'Total', 'État'], ...d.sales.flatMap(s => s.items.map(i => [s.number, fdt(s.createdAt), s.clientName, i.name, i.qty, i.unit === 'kg' ? 'kg' : 'pièce', i.price, i.total, st(s.status)]))]],
    ['Versements clients', [['N°', 'Date', 'Client', 'Montant', 'Note', 'Saisi par', 'État'], ...d.clientPayments.map(p => [p.number || '', fdt(p.createdAt), p.clientName, p.amount, p.note || '', p.createdByName, st(p.status)])]],
    ['Achats', [['Date facture', 'N° facture', 'Fournisseur', 'Montant', 'Note', 'Saisi par', 'État'], ...d.purchases.map(p => [p.invoiceDate, p.invoiceNo || '', p.supplierName, p.amount, p.note || '', p.createdByName, st(p.status)])]],
    ['Versements fournisseurs', [['Date', 'Fournisseur', 'Montant', 'Note', 'Saisi par', 'État'], ...d.supplierPayments.map(p => [fdt(p.createdAt), p.supplierName, p.amount, p.note || '', p.createdByName, st(p.status)])]],
    ['Journal', [['Date', 'Utilisateur', 'Action', 'Détail'], ...d.journal.sort((a, b) => toDate(a.atDevice) - toDate(b.atDevice)).map(j => [fdt(j.atDevice), j.byName, j.action, j.label])]],
  ];
  download(buildXlsx(sheets), `ventemobile-${isoDay(new Date())}.xlsx`);
}

// ---- Restauration : ajoute seulement les documents absents (rien n'est écrasé) ----
const DATE_KEYS = ['createdAt', 'modifiedAt', 'cancelledAt', 'syncedAt', 'updatedAt', 'at', 'atDevice'];
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
function revive(v, key) {
  if (v && typeof v === 'object' && typeof v.__ts === 'string') return Timestamp.fromDate(new Date(v.__ts));
  if (typeof v === 'string' && DATE_KEYS.includes(key) && ISO.test(v)) return Timestamp.fromDate(new Date(v)); // anciennes sauvegardes
  if (Array.isArray(v)) return v.map(x => revive(x));
  if (v && typeof v === 'object') { const o = {}; for (const k in v) o[k] = revive(v[k], k); return o; }
  return v;
}
export const RESTORE_COLS = ['products', 'clients', 'suppliers', 'sales', 'clientPayments', 'purchases', 'supplierPayments'];
export async function restoreJSON(data, progress = () => {}) {
  let added = 0, skipped = 0; const byCol = {};
  for (const c of RESTORE_COLS) {
    const rows = data.collections[c] || [];
    if (!rows.length) continue;
    progress(`Vérification : ${c}…`);
    const existing = new Set((await getDocs(collection(db, c))).docs.map(d => d.id));
    const missing = rows.filter(r => r.id && !existing.has(r.id));
    skipped += rows.length - missing.length;
    for (let i = 0; i < missing.length; i += 400) {
      const b = writeBatch(db);
      for (const r of missing.slice(i, i + 400)) { const { id, ...rest } = r; b.set(doc(db, c, id), revive(rest)); }
      progress(`Restauration : ${c} (${Math.min(i + 400, missing.length)}/${missing.length})…`);
      await b.commit();
    }
    added += missing.length; byCol[c] = missing.length;
  }
  return { added, skipped, byCol };
}
