import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

// מפתח Service Account: JSON רגיל או מקודד base64
function parseKey(raw) {
  if (!raw) return null;
  let s = raw.trim();
  if (!s.startsWith('{')) s = Buffer.from(s, 'base64').toString('utf8');
  const j = JSON.parse(s);
  if (j.private_key) j.private_key = j.private_key.replace(/\\n/g, '\n');
  return j;
}

const cache = {};
export function fb(name, envVar) {
  if (cache[name]) return cache[name];
  const key = parseKey(process.env[envVar]);
  if (!key) return null;
  const app = getApps().find((a) => a.name === name) || initializeApp({ credential: cert(key), projectId: key.project_id }, name);
  cache[name] = { db: getFirestore(app), auth: getAuth(app), projectId: key.project_id, uids: new Map() };
  return cache[name];
}

export async function uidByEmail(conn, email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) throw new Error('למשתמש לא מוגדר email ב-USERS');
  if (conn.uids.has(e)) return conn.uids.get(e);
  const u = await conn.auth.getUserByEmail(e).catch(() => null);
  if (!u) throw new Error(`לא נמצא חשבון באפליקציה עם המייל ${e}`);
  conn.uids.set(e, u.uid);
  return u.uid;
}

export const norm = (s) => String(s || '').trim().toLowerCase();

// השוואה "רכה" בעברית: בלי רווחים/גרשיים/מקפים, אותיות סופיות כרגילות
const FINALS = { 'ך': 'כ', 'ם': 'מ', 'ן': 'נ', 'ף': 'פ', 'ץ': 'צ' };
export const soft = (s) => norm(s).replace(/[\s'"׳״\-–.,()]/g, '').replace(/[ךםןףץ]/g, (c) => FINALS[c]);

function editDistance(a, b) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

// פריטים עם שם דומה, מהדומה ביותר. כולל התאמה מלאה (score 100)
export function similarBy(list, name, getName) {
  const q = soft(name);
  if (!q) return [];
  const words = norm(name).split(/\s+/).filter((w) => w.length >= 2).map(soft).map((w) => w.replace(/^ה/, ''));
  return list
    .map((item) => {
      const c = soft(getName(item));
      let score = 0;
      if (c === q) score = 100;
      else if ((c.includes(q) || q.includes(c)) && Math.min(c.length, q.length) >= 2) score = 80;
      else if (editDistance(c, q) <= (Math.min(c.length, q.length) >= 5 ? 2 : 1)) score = 70;
      else if (words.some((w) => w.length >= 3 && (c.includes(w) || c.includes(w.slice(0, -1))))) score = 50;
      return { item, score };
    })
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, 4)
    .map((x) => x.item);
}
