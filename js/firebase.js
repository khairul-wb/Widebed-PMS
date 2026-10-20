// One place that starts Firebase. Every page imports from here.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, onAuthStateChanged, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, doc, getDoc }
  from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { firebaseConfig } from './firebase-config.js';

export const configMissing = firebaseConfig.apiKey.startsWith('PASTE');

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// Offline cache: reopening a page reads from the browser first, which saves free-plan reads.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

// Roles that can sign in during Increment 1 (Finance MVP). Other roles can be given now
// and start working when their pages are built.
export const ALLOWED_ROLES = ['director', 'finance'];
export const ROLE_LABEL = { director: 'Director', finance: 'Finance', it: 'IT', operations: 'Operations', hr: 'HR', procurement: 'Procurement' };

// A person's role lives on their staff record, users/{uid} (set on the Staff accounts page).
// The security rules read the same record, so the role here and in the rules always match.
export async function profileOf(user) {
  try {
    const snap = await getDoc(doc(db, 'users', user.uid));
    if (!snap.exists()) return { role: null, name: user.email };
    const p = snap.data();
    return { role: p.active === false ? null : (p.role || null), name: p.displayName || user.email, active: p.active !== false };
  } catch (_) {
    return { role: null, name: user.email };
  }
}

// Resolves once with { user, role, name } (user = null when signed out).
export function whoAmI() {
  return new Promise(resolve => {
    const stop = onAuthStateChanged(auth, async user => {
      stop();
      if (!user) return resolve({ user: null, role: null });
      resolve({ user, ...(await profileOf(user)) });
    });
  });
}

// Use at the top of every signed-in page.
export async function requireRole(allowed = ALLOWED_ROLES) {
  const me = await whoAmI();
  if (!me.user) { location.replace('index.html'); return new Promise(() => {}); }
  if (!allowed.includes(me.role)) {
    if (ALLOWED_ROLES.includes(me.role)) { location.replace('dashboard.html'); return new Promise(() => {}); }
    await signOut(auth);
    location.replace('index.html?noaccess=1');
    return new Promise(() => {});
  }
  return me;
}

export async function logOut() {
  await signOut(auth);
  location.replace('index.html');
}
