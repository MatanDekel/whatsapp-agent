import { runAgent } from '../lib/agent.js';
import { drainActions } from '../lib/store.js';

// נקודת קצה ל-Shortcuts באייפון.
// POST {"text": "..."} → מריץ את הסוכן ומחזיר תשובה + פעולות לביצוע
// POST {} (בלי text)   → סנכרון: מחזיר רק פעולות שממתינות בתור
export async function POST(request) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.SHORTCUT_TOKEN}`) {
    return new Response('unauthorized', { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const text = String(body.text || '').trim();

  const reply = text ? (await runAgent({ channel: 'iphone', text })).reply : '';
  const actions = await drainActions();

  return Response.json({ reply, actions, count: actions.length });
}
