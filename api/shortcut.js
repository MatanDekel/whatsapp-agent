import { runAgent } from '../lib/agent.js';
import { drainActions } from '../lib/store.js';
import { userFromRequest } from '../lib/users.js';

// Shortcuts באייפון. לכל משתמש token משלו — כך השרת יודע של מי הבקשה.
// POST {"text": "..."} → תשובה + פעולות | POST {} → רק פעולות ממתינות
export async function POST(request) {
  const user = userFromRequest(request);
  if (!user) return new Response('unauthorized', { status: 401 });
  const body = await request.json().catch(() => ({}));
  const text = String(body.text || '').trim();

  const reply = text ? (await runAgent({ user, channel: 'iphone', text })).reply : '';
  const actions = await drainActions(user.id);
  return Response.json({ reply, actions, count: actions.length });
}
