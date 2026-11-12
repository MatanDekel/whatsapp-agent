import { createHmac, timingSafeEqual } from 'node:crypto';
import { Client } from '@upstash/qstash';
import { key, redis } from './store.js';
import { localToEpoch, saveCalendar, scheduleEventReminders } from './reminders.js';

const TZ = process.env.TZ_NAME || 'Asia/Jerusalem';
const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/calendar.events', 'https://www.googleapis.com/auth/calendar.readonly'];
const redirectUri = () => `${process.env.APP_URL || `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`}/api/google/callback`;

export const configured = () => Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
export async function isConnected(uid) {
  return configured() && Boolean(await redis.get(key(uid, 'google')));
}

// ── קישור התחברות חתום (תקף לשעה) ──
const sign = (s) => createHmac('sha256', process.env.GOOGLE_CLIENT_SECRET).update(s).digest('base64url');
export function authUrl(uid) {
  const payload = Buffer.from(JSON.stringify({ uid, exp: Date.now() + 3600_000 })).toString('base64url');
  const p = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri(), response_type: 'code',
    scope: SCOPES.join(' '), access_type: 'offline', prompt: 'consent', state: `${payload}.${sign(payload)}`,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}
export function verifyState(state) {
  const [payload, sig] = String(state || '').split('.');
  if (!payload || !sig) return null;
  const a = Buffer.from(sig), b = Buffer.from(sign(payload));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
  return data.exp > Date.now() ? data.uid : null;
}

async function tokenRequest(params) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, ...params }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Google token: ${data.error_description || data.error}`);
  return data;
}

export async function finishConnect(uid, code) {
  const t = await tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: redirectUri() });
  if (!t.refresh_token) throw new Error('Google לא החזיר refresh token — נסו להתחבר שוב');
  const email = t.id_token ? JSON.parse(Buffer.from(t.id_token.split('.')[1], 'base64url').toString()).email : null;
  await redis.set(key(uid, 'google'), { refresh: t.refresh_token, email, connectedAt: Date.now() });
  await redis.set(key(uid, 'google_at'), t.access_token, { ex: Math.max(60, (t.expires_in || 3600) - 120) });
  return email;
}

export async function disconnect(uid) {
  await redis.del(key(uid, 'google'), key(uid, 'google_at'));
}

async function accessToken(uid) {
  const cached = await redis.get(key(uid, 'google_at'));
  if (cached) return cached;
  const g = await redis.get(key(uid, 'google'));
  if (!g?.refresh) throw new Error('יומן Google לא מחובר');
  const t = await tokenRequest({ refresh_token: g.refresh, grant_type: 'refresh_token' }).catch(async (e) => {
    if (/invalid_grant/.test(e.message)) { await disconnect(uid); throw new Error('החיבור ל-Google פג — צריך להתחבר מחדש'); }
    throw e;
  });
  await redis.set(key(uid, 'google_at'), t.access_token, { ex: Math.max(60, (t.expires_in || 3600) - 120) });
  return t.access_token;
}

async function gapi(uid, path, init = {}) {
  const r = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...init, headers: { Authorization: `Bearer ${await accessToken(uid)}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const data = r.status === 204 ? {} : await r.json();
  if (!r.ok) throw new Error(`Google Calendar: ${data.error?.message || r.status}`);
  return data;
}

// משיכת 7 הימים הקרובים מכל היומנים שמוצגים אצל המשתמש, ושמירה בפורמט הרגיל של הסוכן
export async function syncCalendar(uid, days = 7) {
  const timeMin = new Date(Date.now() - 3600_000).toISOString();
  const timeMax = new Date(Date.now() + days * 86400_000).toISOString();
  const list = await gapi(uid, '/users/me/calendarList?minAccessRole=reader');
  const cals = (list.items || []).filter((c) => c.selected !== false).slice(0, 15);
  const events = [];
  for (const c of cals) {
    const q = new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '250' });
    const res = await gapi(uid, `/calendars/${encodeURIComponent(c.id)}/events?${q}`).catch(() => ({ items: [] }));
    for (const e of res.items || []) {
      if (e.status === 'cancelled') continue;
      const allDay = Boolean(e.start?.date);
      events.push({
        title: e.summary || '(ללא כותרת)',
        start: allDay ? localToEpoch(`${e.start.date} 00:00`) : Date.parse(e.start.dateTime),
        end: allDay ? null : Date.parse(e.end?.dateTime),
        location: e.location || '',
        allDay,
      });
    }
  }
  const saved = await saveCalendar(uid, events);
  await scheduleEventReminders(uid, saved);
  await redis.set(key(uid, 'google_synced'), Date.now());
  return saved.length;
}

// רענון אם הסנכרון האחרון ישן מ-maxAgeMs
export async function syncIfStale(uid, maxAgeMs = 10 * 60_000) {
  if (!(await isConnected(uid))) return;
  const last = Number((await redis.get(key(uid, 'google_synced'))) || 0);
  if (Date.now() - last > maxAgeMs) await syncCalendar(uid).catch((e) => console.error('google sync failed', uid, e.message));
}

function addMinutes(local, minutes) {
  const [d, t = '00:00'] = local.split(/[ T]/);
  const [y, m, day] = d.split('-').map(Number);
  const [h, mi] = t.split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, day, h, mi) + minutes * 60_000).toISOString().slice(0, 16);
}

// יצירת אירוע ביומן הראשי. start/end: "YYYY-MM-DD HH:mm" לפי שעון ישראל, או "YYYY-MM-DD" לאירוע של יום שלם
export async function createEvent(uid, { title, start, end, location, description, durationMinutes }) {
  const allDay = /^\d{4}-\d{2}-\d{2}$/.test(String(start).trim());
  const body = { summary: title, location: location || undefined, description: description || undefined };
  if (allDay) {
    const s = String(start).trim();
    body.start = { date: s };
    body.end = { date: addMinutes(`${String(end || s).trim()} 00:00`, 24 * 60).slice(0, 10) };
  } else {
    const s = String(start).trim().replace(' ', 'T').slice(0, 16);
    const e = end ? String(end).trim().replace(' ', 'T').slice(0, 16) : addMinutes(s, Number(durationMinutes) || 60);
    body.start = { dateTime: `${s}:00`, timeZone: TZ };
    body.end = { dateTime: `${e}:00`, timeZone: TZ };
  }
  const ev = await gapi(uid, '/calendars/primary/events', { method: 'POST', body: JSON.stringify(body) });
  await syncCalendar(uid).catch(() => {});
  return { created: ev.summary, when: allDay ? body.start.date : body.start.dateTime.replace('T', ' ').slice(0, 16), link: ev.htmlLink };
}

// יוצר פעם אחת תזמון שעתי ב-QStash לסנכרון היומנים
export async function ensureHourlySync() {
  const flag = await redis.set('google_sync_schedule', 1, { nx: true });
  if (flag !== 'OK') return;
  try {
    const base = process.env.APP_URL || `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
    await new Client({ token: process.env.QSTASH_TOKEN, baseUrl: process.env.QSTASH_URL || undefined })
      .schedules.create({ destination: `${base}/api/cron/google-sync`, cron: '7 * * * *' });
  } catch (e) {
    await redis.del('google_sync_schedule');
    console.error('could not create QStash schedule', e.message);
  }
}
