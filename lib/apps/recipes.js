import { readFileSync } from 'node:fs';
import { fb, norm, soft, uidByEmail } from './firebase.js';

// המתכונים שכתובים בקוד האפליקציה (recipeBook/index.html): baseRecipes ו-tryRecipes ("מתכונים לנסות")
const load = (f) => JSON.parse(readFileSync(new URL(`../../data/${f}`, import.meta.url), 'utf8'));
const BASE = load('base-recipes.json');
const TRY = load('try-recipes.json');
const LEVELS = ['קל', 'בינוני', 'מאתגר'];

export const enabled = (user) => Boolean(user.email && process.env.FIREBASE_RECIPLYAPP_KEY);

// ספר = משפחה: users/{uid}.familyId → families/{fid}. מתכונים שנוספו דרך האתר: families/{fid}/recipes.
// "אהבנו" למתכון לנסות נשמר ב-families/{fid}/state/main.promoted, ושינויי זמן/קושי ב-state/main.meta.
async function load_(user) {
  const conn = fb('reciply', 'FIREBASE_RECIPLYAPP_KEY');
  const uid = await uidByEmail(conn, user.email);
  const prof = await conn.db.doc(`users/${uid}`).get();
  const fid = prof.exists ? prof.data().familyId : null;
  if (!fid) throw new Error('החשבון לא משויך לספר מתכונים');
  const fam = conn.db.doc(`families/${fid}`);
  const [fsnap, rsnap, ssnap] = await Promise.all([
    fam.get(), fam.collection('recipes').get(), fam.collection('state').doc('main').get(),
  ]);
  if (!fsnap.exists) throw new Error('הספר לא נמצא');
  const builtIn = Boolean(fsnap.data().builtIn);
  const state = ssnap.exists ? ssnap.data() : {};
  const promoted = new Set(Array.isArray(state.promoted) ? state.promoted : []);
  const meta = state.meta || {};
  const applyMeta = (r) => {
    const m = meta[r.title];
    if (!m) return r;
    const o = { ...r };
    if (m.timeMin) o.timeMin = Number(m.timeMin);
    if (m.difficulty && LEVELS.includes(m.difficulty)) o.difficulty = m.difficulty;
    if (m.yield) o.yield = m.yield;
    return o;
  };
  const custom = rsnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const inBook = (builtIn ? BASE.concat(TRY.filter((r) => promoted.has(r.title))).map(applyMeta) : []).concat(custom)
    .map((r) => ({ ...r, status: 'בספר' }));
  const toTry = (builtIn ? TRY.filter((r) => !promoted.has(r.title)).map(applyMeta) : []).map((r) => ({ ...r, status: 'לנסות' }));
  return { conn, fam, fid, builtIn, inBook, toTry, all: inBook.concat(toTry) };
}

const timeOf = (r) => (r.timeMin ? `${r.timeMin} דק׳` : r.time || undefined);
const matches = (r, q) =>
  soft(r.title).includes(soft(q)) || norm(r.category).includes(norm(q)) ||
  (r.ingredients || []).some((i) => soft(i.name).includes(soft(q)));

export async function search(user, query) {
  const b = await load_(user);
  const q = String(query || '').trim();
  const found = q ? b.all.filter((r) => matches(r, q)) : b.all;
  return {
    count: found.length,
    note: 'status "לנסות" = מתכון מרשימת "מתכונים לנסות", שעוד לא סומן "אהבנו" ולכן עוד לא בספר עצמו',
    recipes: found.slice(0, 40).map((r) => ({ title: r.title, category: r.category, time: timeOf(r), difficulty: r.difficulty, status: r.status })),
  };
}

export async function get(user, title) {
  const b = await load_(user);
  const q = soft(title);
  const r = b.all.find((x) => soft(x.title) === q) || b.all.find((x) => soft(x.title).includes(q) || q.includes(soft(x.title)));
  if (!r) return { error: 'לא מצאתי מתכון כזה', suggestions: b.all.slice(0, 40).map((x) => x.title) };
  const { id, createdAt, ...rest } = r;
  return rest;
}

export async function add(user, input) {
  const b = await load_(user);
  const title = String(input.title || '').trim();
  const ingredients = (input.ingredients || [])
    .map((i) => ({ amt: String(i.amt || '').trim(), name: String(i.name || '').trim() }))
    .filter((i) => i.amt || i.name);
  if (!title) return { error: 'חסר שם למתכון' };
  if (!ingredients.length) return { error: 'צריך לפחות מצרך אחד' };
  // אותה בדיקה כמו באתר: אין שני מתכונים באותו שם, וגם לא כמו מתכון מרשימת "לנסות"
  if (b.inBook.some((r) => r.title === title) || (b.builtIn && TRY.some((r) => r.title === title))) {
    return { error: 'כבר יש מתכון בשם הזה' };
  }
  const data = {
    title, category: String(input.category || '').trim() || 'מנות עיקריות', yield: String(input.yield || '').trim(),
    ingredients, steps: (input.steps || []).map(String).filter(Boolean), notes: (input.notes || []).map(String).filter(Boolean),
    createdAt: Date.now(),
  };
  if (Number(input.timeMin) > 0) data.timeMin = Math.round(Number(input.timeMin));
  if (LEVELS.includes(input.difficulty)) data.difficulty = input.difficulty;
  await b.fam.collection('recipes').add(data);
  return { added: title, category: data.category };
}

export async function check(user) {
  const b = await load_(user);
  return { projectId: b.conn.projectId, familyBook: b.fid.slice(0, 4) + '…', builtInRecipes: b.builtIn, inBook: b.inBook.length, toTry: b.toTry.length };
}
