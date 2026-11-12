import { ensureHourlySync, finishConnect, syncCalendar, verifyState } from '../../lib/google.js';
import { userById } from '../../lib/users.js';
import { notifyUser } from '../../lib/whatsapp.js';

const page = (title, text) => new Response(
  `<!doctype html><html lang="he" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><body style="font-family:system-ui,sans-serif;max-width:480px;margin:15vh auto;padding:0 20px;text-align:center;line-height:1.6">
<h1 style="font-size:28px">${title}</h1><p>${text}</p></body></html>`,
  { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
);

export async function GET(request) {
  const p = new URL(request.url).searchParams;
  if (p.get('error')) return page('החיבור בוטל', 'אפשר לבקש מהבוט קישור חדש בכל זמן.');
  const uid = verifyState(p.get('state'));
  const user = uid && userById(uid);
  if (!user) return page('הקישור לא תקף', 'הקישור פג או לא תקין. בקשו מהבוט קישור חדש.');
  try {
    const email = await finishConnect(user.id, p.get('code'));
    const n = await syncCalendar(user.id).catch(() => 0);
    await ensureHourlySync();
    await notifyUser(user, `✅ יומן Google (${email || 'החשבון שלך'}) מחובר. מצאתי ${n} אירועים בשבוע הקרוב.`).catch(() => {});
    return page('✅ יומן Google מחובר', 'אפשר לסגור את החלון ולחזור לוואטסאפ.');
  } catch (e) {
    console.error('google callback failed', e);
    return page('משהו השתבש', 'נסו שוב עם קישור חדש מהבוט.');
  }
}
