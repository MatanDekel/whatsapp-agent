import { saveCalendar, scheduleEventReminders } from '../lib/reminders.js';
import { userFromRequest } from '../lib/users.js';

// סנכרון היומן מהאייפון של כל משתמש (לפי ה-token שלו)
// POST {"events":[{"title","start","end","location","allDay"}]}
export async function POST(request) {
  const user = userFromRequest(request);
  if (!user) return new Response('unauthorized', { status: 401 });
  const body = await request.json().catch(() => ({}));
  const events = await saveCalendar(user.id, body.events);
  const scheduled = await scheduleEventReminders(user.id, events);
  return Response.json({ user: user.name, saved: events.length, scheduled });
}
