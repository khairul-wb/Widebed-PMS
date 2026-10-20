// Firestore reads and writes shared by Upload eZee report, Expenses and Month-end payout.
import { db } from './firebase.js';
import { collection, doc, getDoc, getDocs, query, where, serverTimestamp }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { byUnit } from './engine.js';

export async function loadProperties() {
  const snap = await getDocs(collection(db, 'properties'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(p => p.active !== false)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Latest version whose effectiveFrom is on or before the month. Several versions in the same
// month: the newest one wins, so a same-month correction is just another document.
export function latestVersion(versions, month) {
  return versions
    .filter(v => (v.effectiveFrom || '') <= month)
    .sort((a, b) => (b.effectiveFrom || '').localeCompare(a.effectiveFrom || '') || stampMs(b.createdAt) - stampMs(a.createdAt))[0] || null;
}
const stampMs = t => (t?.toMillis ? t.toMillis() : 0);

export async function loadUnits(propertyId) {
  const snap = await getDocs(query(collection(db, 'units'), where('propertyId', '==', propertyId)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(u => u.active !== false).sort((a, b) => byUnit(a.unitCode, b.unitCode));
}

// Units with every terms version (so the settings panel can show history), plus the property rate version for the month.
export async function loadSetup(propertyId, month) {
  const [units, rateSnap] = await Promise.all([
    loadUnits(propertyId),
    getDocs(collection(db, 'properties', propertyId, 'rateVersions'))
  ]);
  const termSnaps = await Promise.all(units.map(u => getDocs(collection(db, 'units', u.id, 'terms'))));
  units.forEach((u, i) => {
    u.termHistory = termSnaps[i].docs.map(d => ({ id: d.id, ...d.data() }));
    u.terms = latestVersion(u.termHistory, month);
  });
  const rates = latestVersion(rateSnap.docs.map(d => ({ id: d.id, ...d.data() })), month);
  return { units, rates };
}

export async function monthDoc(propertyId, month) {
  const m = await getDoc(doc(db, 'months', `${propertyId}_${month}`));
  return m.exists() ? m.data() : { status: 'open' };
}

export async function loadExpenses(propertyId, month) {
  const snap = await getDocs(query(collection(db, 'expenses'), where('propertyId', '==', propertyId), where('month', '==', month)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function loadBookings(propertyId, month) {
  const snap = await getDocs(query(collection(db, 'bookings'), where('propertyId', '==', propertyId), where('departureMonth', '==', month)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// Every change goes in the audit log (SEC-03).
export function audit(batch, me, { action, entity, propertyId = null, month = null, changes = [], reason = '' }) {
  batch.set(doc(collection(db, 'auditLog')), {
    at: serverTimestamp(), uid: me.user.uid, userName: me.name, role: me.role,
    action, entity, propertyId, month, changes, reason
  });
}

export function friendlyError(e, what) {
  console.error(e);
  if (e.code === 'permission-denied') return 'Firestore refused this. Check the latest security rules are deployed and your role is set.';
  if (e.code === 'failed-precondition') return 'Firestore needs an index for this. Open the browser console (F12) and click the link it gives.';
  if (e.code === 'unavailable') return 'No connection to Firestore. Check the internet and try again.';
  return `Could not ${what}: ${e.message || e}`;
}

// Plain file download (works on the real site; blocked only inside preview frames).
export function download(filename, data, type = 'text/csv') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
export function toCSV(aoa) {
  return '﻿' + aoa.map(r => r.map(v => { const s = v == null ? '' : String(v); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\r\n');
}
