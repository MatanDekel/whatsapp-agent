import { runAgent } from '../lib/agent.js';
import { getUsers } from '../lib/users.js';

// בדיקת עשן לסוכן: שאלה קבועה, בלי שמירת היסטוריה. GET /api/agent-check?key=<CRON_SECRET>
export async function GET(request) {
  const key = new URL(request.url).searchParams.get('key');
  if (!key || key !== process.env.CRON_SECRET) return new Response('unauthorized', { status: 401 });
  const user = getUsers()[0];
  const t0 = Date.now();
  const { reply } = await runAgent({
    user, channel: 'iphone', saveHistory: false,
    text: 'ענה במשפט אחד: איזה יום בשבוע ומה התאריך מחרתיים?',
  });
  return Response.json({ ms: Date.now() - t0, reply });
}
