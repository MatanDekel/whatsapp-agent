import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fb, norm, uidByEmail } from './firebase.js';

// המתכונים המובנים בספר (recipeBook/index.html → baseRecipes)
const BASE = JSON.parse(readFileSync(new URL('../../data/base-recipes.json', import.meta.url), 'utf8'));
// אותה רשימת בעלים כמו באפליקציה — לבעלים יש ספר משותף ("owners")
const OWNER_HASHES = [
  '323ba53e7e4910088172d3c85c662e137216d3b38abd0d89ad9d86cca698c3ff',
  '44f121df88d654d14b526d36d61103a79d617e09475f0837f231b0c267927f2c',
];

export const enabled = (user) => Boolean(user.email && process.env.FIREBASE_RECIPLYAPP_KEY);

async function book(user) {
  const conn = fb('reciply', 'FIREBASE_RECIPLYAPP_KEY');
  const email = norm(user.email);
  const owner = OWNER_HASHES.includes(createHash('sha256').update(email).digest('hex'));
  const ws = owner ? 'owners' : await uidByEmail(conn, email);
  return { conn, owner, col: conn.db.collection(`books/${ws}/recipes`) };
}

async function all(user) {
  const b = await book(user);
  const snap = await b.col.get();
  const custom = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return { b, list: (b.owner ? BASE : []).concat(custom) };
}

const matches = (r, q) =>
  norm(r.title).includes(q) || norm(r.category).includes(q) ||
  (r.ingredients || []).some((i) => norm(i.name).includes(q));

export async function search(user, query) {
  const { list } = await all(user);
  const q = norm(query);
  const found = q ? list.filter((r) => matches(r, q)) : list;
  return { count: found.length, recipes: found.slice(0, 40).map((r) => ({ title: r.title, category: r.category, time: r.time || undefined })) };
}

export async function get(user, title) {
  const { list } = await all(user);
  const q = norm(title);
  const r = list.find((x) => norm(x.title) === q) || list.find((x) => norm(x.title).includes(q));
  if (!r) return { error: 'לא מצאתי מתכון כזה' };
  const { id, createdAt, ...rest } = r;
  return rest;
}

export async function add(user, input) {
  const { b, list } = await all(user);
  const title = String(input.title || '').trim();
  const ingredients = (input.ingredients || []).map((i) => ({ amt: String(i.amt || '').trim(), name: String(i.name || '').trim() })).filter((i) => i.amt || i.name);
  if (!title) return { error: 'חסר שם למתכון' };
  if (!ingredients.length) return { error: 'צריך לפחות מצרך אחד' };
  if (list.some((r) => r.title === title)) return { error: 'כבר יש מתכון בשם הזה' };
  const data = {
    title, category: String(input.category || '').trim() || 'שונות',
    time: String(input.time || ''), yield: String(input.yield || ''),
    ingredients, steps: (input.steps || []).map(String).filter(Boolean), notes: (input.notes || []).map(String).filter(Boolean),
    createdAt: Date.now(),
  };
  await b.col.add(data);
  return { added: title, category: data.category };
}

export async function check(user) {
  const { b, list } = await all(user);
  return { projectId: b.conn.projectId, sharedBook: b.owner, recipes: list.length };
}
