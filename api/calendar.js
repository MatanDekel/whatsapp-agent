import { saveCalendar, scheduleEventReminders } from '../lib/reminders.js';

// ה-Shortcut באייפון שולח לכאן את האירועים של השבוע הקרוב
// POST {"events":[{"title","start","end","location","allDay"}]}  (start/end ב-ISO 8601)
export async function POST(request) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.SHORTCUT_TOKEN}`) {
    return new Response('unauthorized', { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const events = await saveCalendar(body.events);
  const scheduled = await scheduleEventReminders(events);
  return Response.json({ saved: events.length, scheduled });
}
