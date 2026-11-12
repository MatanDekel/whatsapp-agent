import { fb, norm, uidByEmail } from './firebase.js';

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

// השוואה "רכה" בעברית: בלי רווחים/גרשיים/מקפים, אותיות סופיות כרגילות
const FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
const soft = (s) => norm(s).replace(/[\s'"׳״\-–.,()]/g, '').replace(/[ךםןףץ]/g, (c) => FINALS[c]);
const find = (state, name) => {
  const n = norm(name), sn = soft(name);
  return state.catalog.find((p) => norm(p.name) === n) || state.catalog.find((p) => soft(p.name) === sn) || null;
};

function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}
// מוצרים קיימים עם שם דומה (לא זהה)
function similar(state, name) {
  const q = soft(name);
  if (!q) return [];
  const words = norm(name).split(/\s+/).filter((w) => w.length >= 2).map(soft);
  return state.catalog
    .map((p) => {
      const c = soft(p.name);
      let score = 0;
      if (c === q) score = 100;
      else if (q.length >= 2 && (c.includes(q) || q.includes(c)) && Math.min(c.length, q.length) >= 2) score = 80;
      else if (editDistance(c, q) <= (Math.min(c.length, q.length) >= 5 ? 2 : 1)) score = 70;
      else if (words.some((w) => w.length >= 3 && c.includes(w))) score = 50;
      return { p, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((x) => x.p);
}

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
