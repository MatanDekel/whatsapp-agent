import { Client, Receiver } from '@upstash/qstash';
import { createHash, randomUUID } from 'node:crypto';
import { key, redis } from './store.js';

const TZ = process.env.TZ_NAME || 'Asia/Jerusalem';
const MAX_DELAY_MS = 6.5 * 24 * 3600 * 1000; // QStash בתוכנית החינמית מגביל עיכוב לשבוע
const qstash = () => new Client({ token: process.env.QSTASH_TOKEN, baseUrl: process.env.QSTASH_URL || undefined });
const baseUrl = () => process.env.APP_URL || `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;

// ---------- זמנים ----------
function tzOffset(ts, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ts));
  const g = (k) => Number(parts.find((p) => p.type === k).value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - ts;
}

// "YYYY-MM-DD HH:mm" בשעון המקומי → epoch ms (כולל שעון קיץ)
export function localToEpoch(str, tz = TZ) {
  const [d, t = '09:00'] = String(str).trim().split(/[ T]/);
  const [y, m, day] = d.split('-').map(Number);
  const [h, mi] = t.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, day, h, mi || 0);
  let ts = guess - tzOffset(guess, tz);
  const off2 = tzOffset(ts, tz);
  if (guess - off2 !== ts) ts = guess - off2;
  return ts;
}

export const formatLocal = (ts) =>
  new Intl.DateTimeFormat('he-IL', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(ts));

async function publish(body, at) {
  const { messageId } = await qstash().publishJSON({
    url: `${baseUrl()}/api/reminder-fire`,
    body,
    notBefore: Math.floor(at / 1000),
  });
  return messageId;
}

// ---------- תזכורות ידניות ("תזכיר לי...") ----------
export async function scheduleReminder(uid, text, when) {
  const at = localToEpoch(when);
  if (Number.isNaN(at)) throw new Error('זמן לא תקין, צריך YYYY-MM-DD HH:mm');
  if (at < Date.now() - 60_000) throw new Error('הזמן הזה כבר עבר');
  const r = { id: randomUUID().slice(0, 8), text, at, qid: null };
  if (at - Date.now() < MAX_DELAY_MS) r.qid = await publish({ kind: 'manual', uid, id: r.id }, at);
  await redis.hset(key(uid, 'reminders'), { [r.id]: r }); // רחוקות מדי ייתזמנו ע"י ה-cron היומי
  return { id: r.id, text, when: formatLocal(at) };
}

export async function listReminders(uid) {
  const all = Object.values((await redis.hgetall(key(uid, 'reminders'))) || {});
  return all.sort((a, b) => a.at - b.at).map((r) => ({ id: r.id, text: r.text, when: formatLocal(r.at) }));
}

export async function cancelReminder(uid, id) {
  const r = await redis.hget(key(uid, 'reminders'), id);
  if (!r) return { error: 'לא נמצאה תזכורת' };
  if (r.qid) await qstash().messages.delete(r.qid).catch(() => {});
  await redis.hdel(key(uid, 'reminders'), id);
  return { cancelled: id };
}

export async function takeReminder(uid, id) {
  const r = await redis.hget(key(uid, 'reminders'), id);
  if (r) await redis.hdel(key(uid, 'reminders'), id);
  return r;
}

// נקרא מה-cron היומי: מתזמן תזכורות שנכנסו לטווח השבוע
export async function promoteDistantReminders(uid) {
  const all = Object.values((await redis.hgetall(key(uid, 'reminders'))) || {});
  for (const r of all) {
    if (!r.qid && r.at - Date.now() < MAX_DELAY_MS) {
      r.qid = await publish({ kind: 'manual', uid, id: r.id }, Math.max(r.at, Date.now()));
      await redis.hset(key(uid, 'reminders'), { [r.id]: r });
    }
  }
}

// ---------- לוח זמנים (מסונכרן מהאייפון) ----------
export async function saveCalendar(uid, events) {
  const clean = (events || [])
    .map((e) => ({
      title: String(e.title || '').trim(),
      start: Date.parse(e.start),
      end: e.end ? Date.parse(e.end) : null,
      location: e.location || '',
      allDay: e.allDay === true || e.allDay === 'Yes' || e.allDay === 'true',
    }))
    .filter((e) => e.title && !Number.isNaN(e.start))
    .sort((a, b) => a.start - b.start);
  await redis.set(key(uid, 'calendar'), { syncedAt: Date.now(), events: clean });
  return clean;
}

export async function getCalendar(uid) {
  return (await redis.get(key(uid, 'calendar'))) || { syncedAt: null, events: [] };
}

export async function getSchedule(uid, from, to) {
  const { syncedAt, events } = await getCalendar(uid);
  const a = from ? localToEpoch(`${from} 00:00`) : Date.now() - 3600_000;
  const b = to ? localToEpoch(`${to} 23:59`) : a + 7 * 24 * 3600_000;
  return {
    synced: syncedAt ? formatLocal(syncedAt) : 'עוד לא סונכרן',
    events: events
      .filter((e) => e.start >= a && e.start <= b)
      .map((e) => ({ title: e.title, start: e.allDay ? 'כל היום' : formatLocal(e.start), location: e.location || undefined })),
  };
}

const eventKey = (e) => createHash('sha1').update(`${e.title}|${e.start}`).digest('hex').slice(0, 16);

// תזכורת אוטומטית X דקות לפני כל אירוע (פעם אחת לכל אירוע)
export async function scheduleEventReminders(uid, events) {
  const lead = Number(process.env.EVENT_REMINDER_MINUTES ?? 30);
  if (!lead) return 0;
  let n = 0;
  for (const e of events) {
    const at = e.start - lead * 60_000;
    if (e.allDay || at < Date.now() || at - Date.now() > MAX_DELAY_MS) continue;
    const k = eventKey(e);
    const fresh = await redis.set(key(uid, `evrem:${k}`), 1, { nx: true, ex: 8 * 24 * 3600 });
    if (fresh !== 'OK') continue;
    await publish({ kind: 'event', uid, title: e.title, start: e.start, location: e.location, lead }, at);
    n++;
  }
  return n;
}

// לפני שליחה: האירוע עדיין קיים באותה שעה?
export async function eventStillExists(uid, title, start) {
  const { events } = await getCalendar(uid);
  return events.some((e) => e.title === title && e.start === start);
}

export async function verifyQStash(rawBody, signature) {
  try {
    return await new Receiver({
      currentSigningKey: process.env.QSTASH_CURRENT_SIGNING_KEY,
      nextSigningKey: process.env.QSTASH_NEXT_SIGNING_KEY,
    }).verify({ signature, body: rawBody });
  } catch {
    return false;
  }
}
