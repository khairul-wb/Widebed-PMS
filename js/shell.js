// Sidebar, top bar, Ctrl K jump list and toast. Shared by every signed-in page.
// Folding groups: only the group of the current page is open (agreed 19 Oct for all roles).
import { logOut, ROLE_LABEL } from './firebase.js';

// href = null means the page is not built yet.
const P = (label, href = null) => ({ label, href });
const HR_STAFF = { label: 'HR', items: [P('Attendance SOP'), P('Advance SOP'), P('Allowance SOP'), P('Claim SOCSO'), P('Raise a complaint')] };

export const NAV = {
  finance: [
    { items: [P('Dashboard', 'dashboard.html'), P('Portfolio')] },
    { label: 'Finance', items: [P('Upload eZee report', 'upload.html'), P('Expenses & Reimbursements', 'expenses.html'), P('Month-end payout', 'month-end.html'),
      P('Invoices & Receipts'), P('Offline payments'), P('Sales leads')] },
    { label: 'Operations', items: [P('Issues')] },
    { label: 'Playbook', items: [P('Onboarding'), P('Business Model')] },
    HR_STAFF
  ],
  director: [
    { items: [P('Dashboard', 'dashboard.html'), P('Tasks'), P('Portfolio')] },
    { label: 'Finance', items: [P('Upload eZee report', 'upload.html'), P('Expenses & Reimbursements', 'expenses.html'), P('Month-end payout', 'month-end.html'),
      P('Invoices & Receipts'), P('Offline payments')] },
    { label: 'Operations', items: [P('Issues'), P('Sales leads'), P('Booking forms')] },
    { label: 'Procurement', items: [P('New listings'), P('Forms')] },
    { label: 'Playbook', items: [P('Onboarding'), P('Business Model')] },
    { label: 'Settings', items: [P('Staff accounts', 'staff.html'), P('Brand logos'), P('Audit log')] },
    { label: 'HR', items: [P('Attendance SOP'), P('Advance SOP'), P('Allowance SOP'), P('Claim SOCSO'),
      P('Staff complaints'), P('Director complaints'), P('Raise a complaint')] }
  ]
};

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function toast(msg) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = 'toast'; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 2600);
}
export const notBuilt = label => toast(`${label} is not built yet.`);

function navLink(item, activeLabel) {
  const active = item.label === activeLabel ? ' active' : '';
  const href = item.href || '#';
  return `<a class="nav-item${active}" href="${href}" data-label="${esc(item.label)}"${item.href ? '' : ' data-soon'}>${esc(item.label)}</a>`;
}

export function renderShell({ role, name, active }) {
  const groups = NAV[role] || [];
  // Only the current page's group is open. On an ungrouped page (Dashboard) the first group opens.
  const inGroup = groups.some(g => g.label && g.items.some(it => it.label === active));
  const firstGroup = groups.find(g => g.label);
  const sb = document.getElementById('sidebar');
  sb.innerHTML = `
    <div class="brand"><div class="brand-mark">W</div><div><div class="brand-name">Widebed</div><div class="brand-sub">Property Management</div></div></div>
    <nav>${groups.map((g, i) => {
      const links = g.items.map(it => navLink(it, active)).join('');
      if (!g.label) return links;
      const open = inGroup ? g.items.some(it => it.label === active) : g === firstGroup;
      return `<button class="nav-group-btn" aria-expanded="${open}" data-group="${i}">${esc(g.label)}<span class="chev">›</span></button>
              <div class="nav-group" id="grp-${i}" ${open ? '' : 'hidden'}>${links}</div>`;
    }).join('')}</nav>`;

  sb.addEventListener('click', e => {
    const btn = e.target.closest('.nav-group-btn');
    if (btn) {
      const opening = btn.getAttribute('aria-expanded') !== 'true';
      sb.querySelectorAll('.nav-group-btn').forEach(b => { b.setAttribute('aria-expanded', 'false'); document.getElementById('grp-' + b.dataset.group).hidden = true; });
      if (opening) { btn.setAttribute('aria-expanded', 'true'); document.getElementById('grp-' + btn.dataset.group).hidden = false; }
      return;
    }
    const soon = e.target.closest('[data-soon]');
    if (soon) { e.preventDefault(); notBuilt(soon.dataset.label); }
  });

  const tb = document.getElementById('topbar');
  tb.innerHTML = `
    <button class="btn menu-btn" id="menuBtn" aria-label="Menu">☰</button>
    <button class="search-btn" id="searchBtn">○ <span>Search pages</span><kbd>Ctrl K</kbd></button>
    <span class="user-name">${esc(name)}</span>
    <span class="role-badge">${esc(ROLE_LABEL[role] || role)}</span>
    <button class="btn" id="logoutBtn">Log out</button>`;
  document.getElementById('logoutBtn').onclick = logOut;
  document.getElementById('menuBtn').onclick = () => sb.classList.toggle('open');
  document.getElementById('searchBtn').onclick = () => openPalette(groups);
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(groups); }
  });
}

// Ctrl K: type part of a page name, Enter to go.
function openPalette(groups) {
  if (document.querySelector('.palette-back')) return;
  const all = groups.flatMap(g => g.items.map(it => ({ ...it, group: g.label || '' })));
  const back = document.createElement('div');
  back.className = 'palette-back';
  back.innerHTML = `<div class="palette" role="dialog" aria-label="Jump to page"><input placeholder="Jump to a page…" aria-label="Page name"><ul></ul></div>`;
  document.body.appendChild(back);
  const input = back.querySelector('input'), list = back.querySelector('ul');
  let shown = all, sel = 0;
  const close = () => back.remove();
  const go = it => { close(); if (it.href) location.href = it.href; else notBuilt(it.label); };
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    shown = all.filter(it => it.label.toLowerCase().includes(q) || it.group.toLowerCase().includes(q));
    sel = Math.min(sel, Math.max(shown.length - 1, 0));
    list.innerHTML = shown.map((it, i) => `<li class="${i === sel ? 'sel' : ''}" data-i="${i}">${esc(it.label)}<small>${esc(it.group)}${it.href ? '' : ' · not built'}</small></li>`).join('')
      || '<li><small>No page matches</small></li>';
  };
  input.addEventListener('input', () => { sel = 0; draw(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, shown.length - 1); draw(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); draw(); e.preventDefault(); }
    if (e.key === 'Enter' && shown[sel]) go(shown[sel]);
    if (e.key === 'Escape') close();
  });
  list.addEventListener('click', e => { const li = e.target.closest('li[data-i]'); if (li) go(shown[+li.dataset.i]); });
  back.addEventListener('click', e => { if (e.target === back) close(); });
  draw(); input.focus();
}
