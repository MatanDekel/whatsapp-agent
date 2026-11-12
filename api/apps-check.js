import { checkAll } from '../lib/apps/index.js';
import { getUsers } from '../lib/users.js';

// בדיקת חיבור לאפליקציות. מחזיר רק מידע לא רגיש (project id, ספירות, שגיאות).
// GET /api/apps-check?key=<CRON_SECRET>
export async function GET(request) {
  const key = new URL(request.url).searchParams.get('key');
  if (!key || key !== process.env.CRON_SECRET) return new Response('unauthorized', { status: 401 });
  const out = {};
  for (const u of getUsers()) out[u.id] = { emailSet: Boolean(u.email), ...(await checkAll(u)) };
  return Response.json(out);
}
