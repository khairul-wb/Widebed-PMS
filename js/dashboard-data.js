// Reads what both dashboards need for one month and one property (or all properties).
// Drafts are not stored (data model §1), so "completed" figures come from statements
// and everything else comes straight from bookings, expenses and units.
import { db } from './firebase.js';
import { collection, doc, getDoc, getDocs, query, where, orderBy, limit }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const scoped = (name, propertyId, ...rest) =>
  propertyId === 'all'
    ? query(collection(db, name), ...rest)
    : query(collection(db, name), where('propertyId', '==', propertyId), ...rest);

export async function loadProperties() {
  const snap = await getDocs(collection(db, 'properties'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(p => p.active !== false)
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function latestTerms(unitId, month) {
  const snap = await getDocs(query(collection(db, 'units', unitId, 'terms'),
    where('effectiveFrom', '<=', month), orderBy('effectiveFrom', 'desc'), limit(1)));
  return snap.empty ? null : snap.docs[0].data();
}

async function monthStatus(propertyId, month, propertyIds) {
  if (propertyId !== 'all') {
    const m = await getDoc(doc(db, 'months', `${propertyId}_${month}`));
    return m.exists() && m.data().status === 'completed';
  }
  if (!propertyIds.length) return false;
  const snap = await getDocs(query(collection(db, 'months'), where('month', '==', month)));
  const done = new Set(snap.docs.filter(d => d.data().status === 'completed').map(d => d.data().propertyId));
  return propertyIds.every(id => done.has(id));
}

export async function loadMonth({ propertyId, month, propertyIds }) {
  const [unitSnap, bookingSnap, statementSnap, expenseSnap, uploadSnap, lastUploadSnap, completed] = await Promise.all([
    getDocs(scoped('units', propertyId)),
    getDocs(scoped('bookings', propertyId, where('departureMonth', '==', month))),
    getDocs(scoped('statements', propertyId, where('month', '==', month))),
    getDocs(scoped('expenses', propertyId, where('month', '==', month))),
    getDocs(query(collection(db, 'importBatches'), where('months', 'array-contains', month), limit(1))),
    getDocs(query(collection(db, 'importBatches'), orderBy('uploadedAt', 'desc'), limit(1))),
    monthStatus(propertyId, month, propertyIds)
  ]);

  const units = unitSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(u => u.active !== false);
  const terms = await Promise.all(units.map(u => latestTerms(u.id, month)));
  units.forEach((u, i) => { u.terms = terms[i]; });
  const unitCode = id => units.find(u => u.id === id)?.unitCode || id || '(no unit)';

  const bookings = bookingSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(b => b.status !== 'cancelled');
  const statements = statementSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const expenses = expenseSnap.docs.map(d => ({ id: d.id, ...d.data() })).filter(e => !e.deleted);

  // ---- KPIs ----
  const rentalIncome = bookings.reduce((s, b) => s + (Number(b.totalInclTax) || 0), 0);
  const payouts = statements.map(s => s.totals?.payout ?? s.fixedRent?.paymentToOwner ?? 0);
  const balToPay = payouts.filter(p => p > 0).reduce((s, p) => s + p, 0);

  // ---- Needs attention (pre-close checklist, OWN-03 / ARR-12) ----
  const attention = [];
  for (const b of bookings) {
    if (!b.unitId) attention.push({ text: `${b.roomRaw || 'Room ?'} · no unit matched (${b.id})`, tag: 'No unit' });
    else if (b.otaKey === 'ctrip' && !(b.ctrip && b.ctrip.guestPaid)) attention.push({ text: `${unitCode(b.unitId)} · Ctrip amount missing (${b.id})`, tag: 'Estimated' });
    if (Number(b.nights) === 0) attention.push({ text: `${unitCode(b.unitId)} · 0 nights (${b.id})`, tag: 'Check' });
  }
  for (const s of statements) {
    const p = s.totals?.payout;
    if (p < 0) attention.push({ text: `${unitCode(s.unitId)} · payout −${Math.abs(p).toFixed(2)}, carries forward`, tag: 'Negative' });
  }
  for (const u of units) if (!u.terms) attention.push({ text: `${u.unitCode} · no fee % set up`, tag: 'Set up', unit: u });

  // ---- Statements by status ----
  const completedIds = new Set(statements.map(s => s.unitId));
  const estimatedUnits = new Set(bookings.filter(b => b.otaKey === 'ctrip' && !(b.ctrip && b.ctrip.guestPaid)).map(b => b.unitId));
  const byStatus = {
    fixedRent: units.filter(u => u.terms?.arrangement === 'fixedRent').length,
    draft: units.filter(u => !completedIds.has(u.id)).length,
    negative: payouts.filter(p => p < 0).length,
    estimated: estimatedUnits.size,
    completed: completedIds.size
  };

  // ---- Month-end progress ----
  const uploaded = !uploadSnap.empty;
  const ctripLeft = estimatedUnits.size;
  const done = [uploaded, uploaded && (expenses.length > 0 || completed), uploaded && ctripLeft === 0, completed, completed];
  const current = done.indexOf(false);
  const steps = ['Upload', 'Expenses', 'Ctrip', 'Review', 'Complete'].map((label, i) => ({ label, n: i + 1, done: done[i], current: i === current }));
  let progressNote;
  if (!uploaded) progressNote = 'No eZee report uploaded for this month yet.';
  else if (completed) progressNote = 'Month completed. Statements are read-only.';
  else if (ctripLeft) progressNote = `${ctripLeft} unit${ctripLeft > 1 ? 's' : ''} ${ctripLeft > 1 ? 'still need' : 'still needs'} a Ctrip amount. Approve & complete unlocks when nothing is Estimated.`;
  else progressNote = 'Ready for review. Clear Needs attention, then Approve & complete.';

  const recentExpenses = [...expenses].sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 5)
    .map(e => ({ ...e, unitCode: unitCode(e.unitId), signedAmount: e.kind === 'reimburse' ? e.amount : -e.amount }));

  return {
    unitCount: units.length,
    rentalIncome, balToPay, statementsDone: completedIds.size,
    attention, byStatus, steps, progressNote, recentExpenses,
    lastUpload: lastUploadSnap.empty ? null : lastUploadSnap.docs[0].data().uploadedAt
  };
}

// Director only: who signed in lately (users.lastLoginAt, written at sign-in).
export async function loadTeamActivity() {
  const snap = await getDocs(query(collection(db, 'users'), orderBy('lastLoginAt', 'desc'), limit(5)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}
