export const rm = n => 'RM ' + (Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const signed = n => (n < 0 ? '−' : '+') + Math.abs(n).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
export const monthName = ym => { const [y, m] = ym.split('-'); return `${MONTHS[+m - 1]} ${y}`; };
export const shortMonth = ym => MONTHS[+ym.split('-')[1] - 1].slice(0, 3);
export const ddmm = d => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : '';
// Malaysia time, so the default month is right even late at night.
export function monthOffset(offset) {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }));
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
export function when(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const now = new Date();
  const time = d.toLocaleTimeString('en-MY', { hour: '2-digit', minute: '2-digit', hour12: false });
  const days = Math.floor((now.setHours(0,0,0,0) - new Date(d).setHours(0,0,0,0)) / 86400000);
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  return `${days} days ago`;
}
export const stamp = ts => {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString('en-MY', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
};
// Plain 2-decimal amount with a real minus sign, for tables.
export const amt = n => (n == null || n === '' ? '' : (Number(n) < -0.004 ? '−' : '') + Math.abs(Number(n) || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
export const pct = x => `${+(Number(x || 0) * 100).toFixed(2)}%`;
export const dmy = d => d ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '';
// Today in Malaysia, as YYYY-MM-DD, moved by `days`.
export function dayOffset(days) {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kuala_Lumpur' }));
  now.setDate(now.getDate() + days);
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
