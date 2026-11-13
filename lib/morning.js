import { Client } from '@upstash/qstash';
import { key, redis } from './store.js';

const TZ = process.env.TZ_NAME || 'Asia/Jerusalem';
export const DEFAULT_INSTRUCTIONS =
  'הלו"ז של היום (get_schedule להיום), משימות להיום ובאיחור, ותזכורות שמתוכננות להיום. עד 8 שורות. אם אין כלום — כתוב בוקר טוב קצר.';
const baseUrl = () => process.env.APP_URL || `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
const qstash = () => new Client({ token: process.env.QSTASH_TOKEN, baseUrl: process.env.QSTASH_URL || undefined });

export const getMorning = async (uid) => (await redis.get(key(uid, 'morning'))) || null;

const view = (c) => ({
  enabled: c.enabled !== false,
  time: c.time || 'ברירת מחדל (בערך 07:00 בשעון ישראל)',
  instructions: c.instructions || `ברירת מחדל: ${DEFAULT_INSTRUCTIONS}`,
});

export async function describeMorning(uid) {
  return view((await getMorning(uid)) || {});
}

// instructions: מה ההודעה תכלול | time: "HH:mm" שעון ישראל | enabled | resetToDefault
export async function setMorning(uid, { instructions, time, enabled, resetToDefault } = {}) {
  const cur = (await getMorning(uid)) || {};
  const next = { ...cur };
  if (resetToDefault) delete next.instructions;
  if (typeof instructions === 'string' && instructions.trim()) next.instructions = instructions.trim().slice(0, 1000);
  if (time !== undefined && time !== null && time !== '') {
    const m = String(time).trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m || +m[1] > 23 || +m[2] > 59) throw new Error('שעה לא תקינה, צריך HH:mm, למשל 07:30');
    next.time = `${m[1].padStart(2, '0')}:${m[2]}`;
  }
  if (typeof enabled === 'boolean') next.enabled = enabled;
  if (next.enabled === undefined) next.enabled = true;

  // תזמון אישי ב-QStash רק אם נקבעה שעה וההודעה פעילה. קודם יוצרים את החדש, ואז מוחקים את הישן
  let scheduleId = null;
  if (next.enabled && next.time) {
    const [h, mi] = next.time.split(':').map(Number);
    ({ scheduleId } = await qstash().schedules.create({
      destination: `${baseUrl()}/api/cron/morning`,
      cron: `CRON_TZ=${TZ} ${mi} ${h} * * *`,
      body: JSON.stringify({ uid }),
      headers: { 'Content-Type': 'application/json' },
    }));
  }
  if (cur.scheduleId) await qstash().schedules.delete(cur.scheduleId).catch(() => {});
  next.scheduleId = scheduleId;
  await redis.set(key(uid, 'morning'), next);
  return view(next);
}

export function buildPrompt(cfg, familyLine = '') {
  return cfg?.instructions
    ? `הכן את הודעת הבוקר. הנחיות מהמשתמש, עקוב אחריהן בדיוק (תוכן, אורך וסגנון): "${cfg.instructions}". ` +
        'אסוף מידע בעזרת הכלים רק אם ההנחיות דורשות. כתוב רק את ההודעה עצמה, בלי פתיח ובלי שאלות.'
    : `הכן סיכום בוקר קצר: ${DEFAULT_INSTRUCTIONS}${familyLine}`;
}
