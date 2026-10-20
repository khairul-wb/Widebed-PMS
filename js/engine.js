// Widebed payout engine (BRD §9A). Plain JavaScript, no Firebase inside, so it can be
// tested on its own. Used by Upload eZee report and Month-end payout.
//
// Booking PTO (payment to owner) by method, following Finance's methods:
//   Net OTA     guestPaid = (room + SST) / (1 - commission)
//               PTO = guestPaid / 1.08 - (guestPaid - (room + SST))
//               (Finance's Aug and Sep method. Jun and Jul grossed up the cleaning fee too, a few sen different.)
//   Ctrip       typed Trip.com amount T: PTO = (T - cleaning) / 1.08 - (T - (room + SST + cleaning))
//               no amount yet: estimated at 15% like a Net OTA, flagged Estimated
//   Booking.com PTO = room + SST - (commission + payment fee + 8% SST on each), each rounded to the sen
//   Direct      PTO = (room + SST) / 1.08   (Finance always takes 8% off, even when eZee shows no SST)
//   Long-term   PTO = room + SST
//   Early check-in goes to the owner after SST; other incidentals stay with Widebed.

export const r2 = x => Math.round((x + Math.sign(x) * 1e-9) * 100) / 100;
export const round05 = x => Math.sign(x) * Math.round(Math.abs(x) / 0.05 + 1e-9) * 0.05;
const num = v => { const n = parseFloat(String(v ?? '').replace(/,/g, '')); return isFinite(n) ? n : 0; };

// ---------- Arrangements (BRD §9A.8) ----------
export const ARRANGEMENTS = {
  profitShare40: { label: 'Profit share 40%', serviceFeePct: 0.20, utilityFeePct: 0.20, sstOnFeePct: 0 },
  profitShare20: { label: 'Profit share 20%', serviceFeePct: 0.20, utilityFeePct: 0, sstOnFeePct: 0 },
  longTermTenant: { label: 'Long-term tenant', serviceFeePct: 0.10, utilityFeePct: 0, sstOnFeePct: 0.08 },
  fixedRent: { label: 'Fixed rent', serviceFeePct: 0, utilityFeePct: 0, sstOnFeePct: 0 }
};

// Property default OTA settings (ARR-10, ARR-10a). Units can override any of them.
export const DEFAULT_OTA = {
  agoda: { label: 'Agoda', payout: 'net', commissionPct: 0.1836 },
  tiket: { label: 'Tiket.com', payout: 'net', commissionPct: 0.17 },
  traveloka: { label: 'Traveloka', payout: 'net', commissionPct: 0.15 },
  expedia: { label: 'Expedia', payout: 'net', commissionPct: 0.17 },
  ctrip: { label: 'Ctrip', payout: 'net', commissionPct: 0.15 },
  bookingcom: { label: 'Booking.com', payout: 'gross', commissionPct: 0.18, paymentFeePct: 0.028, sstPct: 0.08 }
};

export function otaKeyOf(source) {
  const s = String(source || '').toLowerCase().replace(/[^a-z]/g, '');
  if (s.startsWith('agoda')) return 'agoda';
  if (s.startsWith('tiket')) return 'tiket';
  if (s.startsWith('traveloka')) return 'traveloka';
  if (s.startsWith('expedia')) return 'expedia';
  if (s === 'ctrip' || s.startsWith('tripcom')) return 'ctrip';
  if (s.startsWith('bookingcom')) return 'bookingcom';
  return 'direct';   // Walk-in, Offline, Shortstay.com.my (our own site), Book On Google, Facebook...
}

// ---------- eZee CSV ----------
export function parseCSV(text) {
  const rows = []; let row = []; let f = ''; let q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(f); rows.push(row); row = []; f = '';
    } else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows;
}

// "DM 07-19-1 Bedroom Suite" -> { property: "DM", unit: "DM 0719" }; "DM 14-08-2-Studio" -> "DM 1408-2"
export function unitCodeOf(room) {
  const m = /^(\S+) (\d{2})-(\d{2}[A-Z]?)(-\d+(?=-))?/.exec(room || '');
  return m ? { property: m[1], unit: `${m[1]} ${m[2]}${m[3]}${m[4] || ''}` } : null;
}
// eZee dates are d/m/yyyy
export function isoDate(d) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(String(d || '').trim());
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

const NEED = ['Reservation No', 'Source', 'Arrival', 'Dept.', 'Nights', 'Room', 'Rate Type', 'All Room Charges (RM) (Exclusive of Tax)', 'Total (RM) (Inclusive of Tax)'];
const AMOUNTS = {
  allRoomCharges: 'All Room Charges (RM) (Exclusive of Tax)',
  sst: 'SST (RM)',
  cleaningFee: 'Cleaning Fee (RM) (Exclusive of Tax)',
  earlyCheckIn: 'Early Check-in (RM) (Exclusive of Tax)',
  roomUpgrade: 'Room Upgrade (RM) (Exclusive of Tax)',
  tourismTax: 'Tourism Tax (RM) (Exclusive of Tax)',
  securityDeposit: 'Security Deposit (RM) (Exclusive of Tax)',
  otherCharges: 'Other Charges (RM) (Exclusive of Tax)',
  discount: 'Discount (RM)',
  totalInclTax: 'Total (RM) (Inclusive of Tax)',
  commission: 'Commission (RM)',
  otherPaymentMethod: 'Other Payment Method (RM)'
};
// Personal data columns: kept out of raw and stored in private/main (IT never sees them)
export const PRIVATE_COLS = { 'Guest Name': 'guestName', 'Bill To Name': 'billToName', 'RegNo': 'regNo' };

// Reads the eZee export into plain booking records. Throws with a plain-English message when the file is wrong.
export function readEzee(rows) {
  if (!rows.length) throw new Error('The file is empty.');
  const header = rows[0].map(h => String(h || '').trim());
  const norm = {}; header.forEach((h, i) => { const k = h.replace(/\s+/g, ' '); if (!(k in norm)) norm[k] = i; });
  const col = n => norm[n.replace(/\s+/g, ' ')];
  const missing = NEED.filter(n => col(n) === undefined);
  if (missing.length) throw new Error('This is not the eZee Detail Revenue report. Missing columns: ' + missing.join(', ') + '. Export it from eZee as CSV and try again.');
  const get = (r, n) => { const i = col(n); return i === undefined ? '' : String(r[i] ?? '').trim(); };
  const records = [];
  for (const r of rows.slice(1)) {
    const reservationNo = get(r, 'Reservation No');
    if (r.length < 2 || !reservationNo) continue;
    const roomRaw = get(r, 'Room'), code = unitCodeOf(roomRaw);
    const departure = isoDate(get(r, 'Dept.'));
    const rec = {
      reservationNo, folioNo: get(r, 'Folio No'), invoiceNo: get(r, 'Invoice No'),
      source: get(r, 'Source'), otaKey: otaKeyOf(get(r, 'Source')), rateType: get(r, 'Rate Type'),
      arrival: isoDate(get(r, 'Arrival')), departure, departureMonth: departure ? departure.slice(0, 7) : null,
      nights: num(get(r, 'Nights')), roomRaw,
      propertyCode: code ? code.property : null, unitCode: code ? code.unit : null,
      // eZee row with no room number = cancelled (CSV-20). A room type with no number counts as no room.
      status: code ? 'active' : 'cancelled',
      private: {}, raw: {}
    };
    for (const [k, h] of Object.entries(AMOUNTS)) rec[k] = num(get(r, h));
    header.forEach((h, i) => {
      const key = 'c' + String(i + 1).padStart(3, '0');
      if (PRIVATE_COLS[h]) { rec.private[PRIVATE_COLS[h]] = String(r[i] ?? '') || null; rec.raw[key] = null; }
      else rec.raw[key] = String(r[i] ?? '');
    });
    records.push(rec);
  }
  if (!records.length) throw new Error('No bookings found in the file.');
  return { header, records };
}

// ---------- Rates ----------
// Lookup order (PTO-02): unit terms override the arrangement's defaults; OTA settings come from
// the property's rate version, then the unit's own OTA overrides.
export function effectiveRates(propertyRates, terms) {
  const arrangement = terms?.arrangement || null;
  const base = ARRANGEMENTS[arrangement] || ARRANGEMENTS.profitShare20;
  const pick = k => (terms && terms[k] != null ? terms[k] : base[k]);
  const ota = {};
  for (const [k, v] of Object.entries(DEFAULT_OTA)) ota[k] = { ...v, ...(propertyRates?.ota?.[k] || {}), ...(terms?.otaOverrides?.[k] || {}) };
  return {
    arrangement, setUp: !!ARRANGEMENTS[arrangement],
    serviceFeePct: pick('serviceFeePct'), utilityFeePct: pick('utilityFeePct'), sstOnFeePct: pick('sstOnFeePct'),
    fixedRentAmount: arrangement === 'fixedRent' ? num(terms.fixedRentAmount) : null,
    earlyCheckInToOwner: propertyRates?.earlyCheckInToOwner !== false,
    versionId: terms?.effectiveFrom || null,
    ota
  };
}

// ---------- One booking ----------
export function bookingPTO(b, rates) {
  const v = { ...b, ...(b.edits || {}) };              // ARR-14 edits win over eZee values
  const AU = num(v.allRoomCharges), AX = num(v.sst), AG = num(v.cleaningFee), AK = num(v.earlyCheckIn);
  const T = AU + AX + AG;                               // what the guest's booking total holds for the room
  const otaKey = v.otaKey || otaKeyOf(v.source);
  const longTerm = otaKey === 'direct' && (num(v.nights) >= 30 || /monthly|yearly/i.test(v.rateType || '') || rates.arrangement === 'longTermTenant');
  let method, guestPaid = 0, platform = 0, pto, estimated = false, note = '';
  const o = rates.ota[otaKey];
  if (otaKey === 'ctrip' && num(v.ctrip?.guestPaid) > 0) {
    method = 'Ctrip'; guestPaid = num(v.ctrip.guestPaid);
    platform = guestPaid - T; pto = (guestPaid - AG) / 1.08 - platform;
  } else if (o && o.payout === 'net') {
    method = otaKey === 'ctrip' ? 'Ctrip' : 'Net';
    guestPaid = (AU + AX) / (1 - num(o.commissionPct));
    platform = guestPaid - (AU + AX); pto = guestPaid / 1.08 - platform;
    if (otaKey === 'ctrip') { estimated = true; note = `Estimated at ${+(o.commissionPct * 100).toFixed(2)}%. Type the Trip.com amount.`; }
  } else if (o && o.payout === 'gross') {
    method = 'Gross';
    const comm = r2(num(o.commissionPct) * T), pay = r2(num(o.paymentFeePct) * num(v.otherPaymentMethod));
    const tax = r2(comm * num(o.sstPct ?? 0.08)) + r2(pay * num(o.sstPct ?? 0.08));
    guestPaid = AU + AX; platform = comm + pay + tax; pto = guestPaid - platform;
  } else if (longTerm) {
    method = 'Long-term'; guestPaid = AU + AX; pto = AU + AX;
  } else {
    method = 'Direct'; guestPaid = AU + AX; pto = (AU + AX) / 1.08;
  }
  const early = rates.earlyCheckInToOwner ? AK / 1.08 : 0;
  pto += early;
  if (num(v.roomUpgrade)) note = (note ? note + ' ' : '') + 'Room Upgrade not paid to owner (rule not confirmed).';
  return { method, otaKey, guestPaid, platform, early, pto, estimated, note, edited: !!b.edits };
}

// ---------- One unit, one month ----------
// expenses: [{ kind: 'expense'|'reimburse'|'broughtForward', amount (positive), description, type, date, id }]
export function unitStatement({ unit, rates, bookings, expenses }) {
  const lines = bookings.filter(b => b.status !== 'cancelled')
    .map(b => ({ booking: b, ...bookingPTO(b, rates) }))
    .sort((a, b) => (a.booking.departure || '').localeCompare(b.booking.departure || '') || (a.booking.arrival || '').localeCompare(b.booking.arrival || ''));
  const exp = (expenses || []).filter(e => !e.deleted).map(e => ({ ...e, signed: e.kind === 'reimburse' ? Math.abs(num(e.amount)) : -Math.abs(num(e.amount)) }));
  const nights = lines.reduce((s, l) => s + num(l.booking.nights), 0);
  const estimated = lines.filter(l => l.estimated).length;
  const base = { unit, rates, lines, expenses: exp, nights, estimated, setUp: rates.setUp };

  if (rates.arrangement === 'fixedRent') {
    const deduction = exp.filter(e => e.signed < 0).reduce((s, e) => s - e.signed, 0);
    const reimburse = exp.filter(e => e.signed > 0).reduce((s, e) => s + e.signed, 0);
    const payout = rates.fixedRentAmount - deduction + reimburse;
    return { ...base, fixed: true, totalReceivable: rates.fixedRentAmount, deduction, reimburse, payout, charges: rates.fixedRentAmount - payout,
      bookingIncome: lines.reduce((s, l) => s + l.pto, 0), status: payout < 0 ? 'negative' : 'fixed' };
  }
  const totalReceivable = lines.reduce((s, l) => s + l.pto, 0);
  const serviceFee = totalReceivable * rates.serviceFeePct;
  const utilityFee = totalReceivable * rates.utilityFeePct;
  const sstOnFee = serviceFee * rates.sstOnFeePct;
  const entitlement = totalReceivable - serviceFee - utilityFee - sstOnFee;
  const totalExpenses = exp.reduce((s, e) => s + e.signed, 0);
  const netReceivable = entitlement + totalExpenses;
  const payout = round05(netReceivable);
  const status = !rates.setUp ? 'notSetUp' : estimated ? 'estimated' : payout < 0 ? 'negative' : 'draft';
  return { ...base, fixed: false, totalReceivable, serviceFee, utilityFee, sstOnFee, entitlement, totalExpenses, netReceivable,
    roundingAdjust: payout - netReceivable, payout, charges: totalReceivable - payout, status };
}

// Payment To Owner summary (ARR-07): negatives are carried forward, not paid.
export function paymentSummary(statements) {
  const pos = s => Math.max(0, s.payout);
  return {
    income: statements.reduce((t, s) => t + s.totalReceivable, 0),
    fixed: statements.filter(s => s.fixed).reduce((t, s) => t + pos(s), 0),
    share: statements.filter(s => !s.fixed).reduce((t, s) => t + pos(s), 0),
    balToPay: statements.reduce((t, s) => t + pos(s), 0),
    carried: statements.filter(s => s.payout < 0).reduce((t, s) => t - s.payout, 0)
  };
}

export const byUnit = (a, b) => String(a).localeCompare(String(b), 'en', { numeric: true });
export const nextMonth = ym => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
export const unitIdOf = (propertyId, unitCode) => `${propertyId}_${unitCode.replace(/\s+/g, '-')}`;

// Starter settings copied from the Upload CSV test page (Finance's Sep 2026 set-up for D'Majestic).
// Used once by "Load starter settings" on Month-end payout; edit any unit afterwards.
export const DM_STARTER = {
  units: [
    ['DM 0719', 'profitShare40'], ['DM 1203', 'longTermTenant'], ['DM 1204', 'profitShare40'], ['DM 1301', 'profitShare20'],
    ['DM 1303', 'profitShare20'], ['DM 1402', 'profitShare20'], ['DM 1408-2', 'longTermTenant', { serviceFeePct: 0, sstOnFeePct: 0 }],
    ['DM 1412', 'profitShare40'], ['DM 1509', 'profitShare40'], ['DM 1512', 'profitShare20'], ['DM 1513A', 'profitShare40'],
    ['DM 1602', 'longTermTenant'], ['DM 1610', 'profitShare40'], ['DM 1706', 'profitShare20'], ['DM 1808', 'profitShare20']
  ],
  fixed: [
    ['DM 0710', 1350], ['DM 0712', 1400], ['DM 0713', 1400], ['DM 0714', 1400], ['DM 0715', 1400], ['DM 0901', 1400], ['DM 0902', 1400],
    ['DM 0904', 1300], ['DM 0910', 1300], ['DM 1011', 1300], ['DM 1511', 1800], ['DM 1703', 2000], ['DM 1905', 1800], ['DM 1906', 1800]
  ],
  aliases: { 'DM 1509': ['DM 1509-2'] }
};
