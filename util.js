// Petites fonctions utilitaires (formatage, dates…)
export const S = { user: null, me: {}, settings: {}, products: [], clients: [], suppliers: [] };

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const r2 = n => Math.round((+n || 0) * 100) / 100;
export const r3 = n => Math.round((+n || 0) * 1000) / 1000;
export const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.').replace(/\s/g, '')); return isNaN(n) ? 0 : n; };
export const fmt = n => r2(n).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/[  ]/g, ' ');
export const fq = n => r3(n).toLocaleString('fr-FR', { maximumFractionDigits: 3 }).replace(/[  ]/g, ' ');
export const toDate = t => t?.toDate ? t.toDate() : (t instanceof Date ? t : (t ? new Date(t) : null));
export const p2 = n => String(n).padStart(2, '0');
export const fd = t => { const d = toDate(t); return d && !isNaN(d) ? `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}` : ''; };
export const fdt = t => { const d = toDate(t); return d && !isNaN(d) ? `${fd(d)} ${p2(d.getHours())}:${p2(d.getMinutes())}` : ''; };
export const isoDay = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
export const parseDay = s => { if (!s) return null; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
export const fday = s => fd(parseDay(s));
export const byName = (a, b) => (a.name || '').localeCompare(b.name || '', 'fr');
export const unitShort = u => u === 'kg' ? 'kg' : 'pc';
export const meName = () => S.me.name || (S.user?.email || '').split('@')[0];
export const isAdmin = () => S.me.role === 'admin';
export const clientById = id => S.clients.find(c => c.id === id);
export const supplierById = id => S.suppliers.find(c => c.id === id);
export const ms = t => toDate(t)?.getTime() || 0;
export const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
export const match = (text, q) => !q || norm(text).includes(norm(q));
// Numéro algérien 0555… -> 213555… pour WhatsApp
export const waPhone = p => { let d = String(p || '').replace(/\D/g, ''); if (d.startsWith('00')) d = d.slice(2); if (d.startsWith('0')) d = '213' + d.slice(1); return d; };
export const el = id => document.getElementById(id);
