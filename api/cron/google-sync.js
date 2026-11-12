import { isConnected, syncCalendar } from '../../lib/google.js';
import { verifyQStash } from '../../lib/reminders.js';
import { getUsers } from '../../lib/users.js';

// סנכרון שעתי של יומני Google (מופעל ע"י QStash), כדי שתזכורות לפני אירועים ייקבעו גם לאירועים חדשים
async function run() {
  const out = {};
  for (const u of getUsers()) {
    if (!(await isConnected(u.id))) continue;
    try { out[u.id] = await syncCalendar(u.id); } catch (e) { out[u.id] = 'error'; console.error('google sync', u.id, e.message); }
  }
  return Response.json(out);
}

async function authorized(request, raw) {
  if (request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`) return true;
  return verifyQStash(raw, request.headers.get('upstash-signature'));
}

export async function POST(request) {
  const raw = await request.text();
  if (!(await authorized(request, raw))) return new Response('unauthorized', { status: 401 });
  return run();
}
export async function GET(request) {
  if (!(await authorized(request, ''))) return new Response('unauthorized', { status: 401 });
  return run();
}
