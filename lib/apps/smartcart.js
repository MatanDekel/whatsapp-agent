import { fb, norm, similarBy, soft, uidByEmail } from './firebase.js';

// אותם כללים כמו באפליקציה (SmartCart/index.html)
const UNITS = { unit: { step: 1, start: 1, max: 99 }, pack: { step: 1, start: 1, max: 99 }, g: { step: 100, start: 500, max: 20000 } };
const defaultUnit = (cat) => (/בשר|עוף/.test(cat) ? 'g' : 'unit');
const unitOf = (p) => (UNITS[p.unit] ? p.unit : defaultUnit(p.cat));
const rid = () => Math.random().toString(36).slice(2, 10);
const valid = (s) => s && Array.isArray(s.cats) && Array.isArray(s.catalog) && typeof s.qty === 'object';
function fmtQty(p, q) {
  const u = unitOf(p);
  if (u === 'g') return q >= 1000 ? `${+(q / 1000).toFixed(2)} ק״ג` : `${q} גר׳`;
  return `${q} ${u === 'pack' ? 'חב׳' : 'יח׳'}`;
}

export const enabled = (user) => Boolean(user.email && process.env.FIREBASE_SMARTCART_KEY);

async function listRef(user) {
  const conn = fb('smartcart', 'FIREBASE_SMARTCART_KEY');
  const uid = await uidByEmail(conn, user.email);
  const prof = await conn.db.doc(`users/${uid}`).get();
  const fid = prof.exists ? prof.data().familyId : null;
  if (!fid) throw new Error('החשבון לא משויך למשפחה ב-SmartCart');
  return { conn, ref: conn.db.doc(`families/${fid}/lists/shopping`) };
}

const find = (state, name) => {
  const n = norm(name), sn = soft(name);
  return state.catalog.find((p) => norm(p.name) === n) || state.catalog.find((p) => soft(p.name) === sn) || null;
};

const similar = (state, name) => similarBy(state.catalog, name, (p) => p.name);

export async function getList(user) {
  const { ref } = await listRef(user);
  const snap = await ref.get();
  const s = snap.exists ? snap.data() : null;
  if (!valid(s)) return { items: [], categories: [], note: 'הרשימה עוד לא נוצרה באפליקציה' };
  const items = s.catalog
    .filter((p) => s.qty[p.id] > 0)
    .map((p) => ({ name: p.name, category: p.cat, amount: fmtQty(p, s.qty[p.id]), bought: !!s.done?.[p.id], note: p.note || undefined }));
  return { categories: s.cats, items };
}

async function mutate(user, fn) {
  const { conn, ref } = await listRef(user);
  return conn.db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const s = snap.exists ? snap.data() : null;
    if (!valid(s)) throw new Error('הרשימה עוד לא נוצרה — צריך לפתוח את SmartCart פעם אחת');
    s.done = s.done || {};
    const result = fn(s);
    tx.set(ref, s);
    return result;
  });
}

// items: [{name, amount?, category?, note?}] — amount ביחידות, ובמוצרי משקל בגרמים
export function addItems(user, items) {
  return mutate(user, (s) => {
    const out = [], ask = [];
    for (const it of items || []) {
      const name = String(it.name || '').trim();
      if (!name) continue;
      let p = find(s, name);
      if (!p && !it.createNew) {
        const like = similar(s, name);
        if (like.length) {
          ask.push({ requested: name, similarExisting: like.map((x) => `${x.name} (${x.cat})${s.qty[x.id] > 0 ? ' — כבר ברשימה' : ''}`) });
          continue;
        }
      }
      if (!p) {
        let cat = it.category && s.cats.includes(it.category) ? it.category : null;
        if (!cat) {
          cat = 'שונות';
          if (!s.cats.includes(cat)) s.cats.push(cat);
        }
        p = { id: rid(), name, cat, unit: defaultUnit(cat) };
        s.catalog.push(p);
      }
      const u = UNITS[unitOf(p)];
      const amount = Number(it.amount);
      if (amount > 0) s.qty[p.id] = Math.min(u.max, Math.round(amount));
      else if (!(s.qty[p.id] > 0)) s.qty[p.id] = u.start;
      delete s.done[p.id];
      if (it.note) p.note = String(it.note).slice(0, 80);
      out.push(`${p.name} (${fmtQty(p, s.qty[p.id])}, ${p.cat})`);
    }
    return ask.length
      ? { added: out, needsConfirmation: ask, instruction: 'שאל את המשתמש לגבי כל מוצר: האם התכוון למוצר הקיים, או להוסיף מוצר חדש. אחרי התשובה קרא שוב עם השם המדויק של המוצר הקיים, או עם createNew: true.' }
      : { added: out };
  });
}

export function removeItems(user, names) {
  return mutate(user, (s) => {
    const removed = [], missing = [];
    for (const n of names || []) {
      const p = find(s, n);
      if (p && s.qty[p.id] > 0) { delete s.qty[p.id]; delete s.done[p.id]; removed.push(p.name); }
      else missing.push(n);
    }
    return { removed, notOnList: missing };
  });
}

export function markBought(user, names, bought = true) {
  return mutate(user, (s) => {
    const marked = [], missing = [];
    for (const n of names || []) {
      const p = find(s, n);
      if (p && s.qty[p.id] > 0) { if (bought) s.done[p.id] = true; else delete s.done[p.id]; marked.push(p.name); }
      else missing.push(n);
    }
    return { marked, notOnList: missing };
  });
}

// ניקוי מוצרים שכבר נקנו (כמו "סיימתי קניות" באפליקציה)
export function clearBought(user) {
  return mutate(user, (s) => {
    let n = 0;
    for (const id of Object.keys(s.done)) { if (s.done[id]) { delete s.qty[id]; n++; } }
    s.done = {};
    return { cleared: n };
  });
}

export async function check(user) {
  const { conn, ref } = await listRef(user);
  const snap = await ref.get();
  return { projectId: conn.projectId, listExists: snap.exists && valid(snap.data()) };
}
