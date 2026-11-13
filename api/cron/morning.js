import { getMorning } from '../../lib/morning.js';
import { sendMorning } from '../../lib/morning-send.js';
import { verifyQStash } from '../../lib/reminders.js';
import { userById } from '../../lib/users.js';

// QStash קורא לכאן בשעה שהמשתמש קבע להודעת הבוקר שלו
export async function POST(request) {
  const raw = await request.text();
  if (!(await verifyQStash(raw, request.headers.get('upstash-signature')))) {
    return new Response('bad signature', { status: 401 });
  }
  const { uid } = JSON.parse(raw);
  const user = userById(uid);
  const cfg = user && (await getMorning(uid));
  if (!user || !cfg || cfg.enabled === false) return Response.json({ skipped: true });
  await sendMorning(user, cfg);
  return Response.json({ sent: true });
}
