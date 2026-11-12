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
