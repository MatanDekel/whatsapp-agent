import { runAgent } from '../../lib/agent.js';
import { notifyOwner } from '../../lib/whatsapp.js';
import { promoteDistantReminders } from '../../lib/reminders.js';

// Vercel Cron — סיכום בוקר לוואטסאפ
export async function GET(request) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('unauthorized', { status: 401 });
  }
  await promoteDistantReminders();
  const { reply } = await runAgent({
    channel: 'cron',
    saveHistory: false,
    text:
      'הכן סיכום בוקר קצר: הלו"ז של היום (get_schedule להיום), משימות להיום ובאיחור, ' +
      'ותזכורות שמתוכננות להיום. עד 8 שורות. אם אין כלום — כתוב בוקר טוב קצר.',
  });
  await notifyOwner(reply);
  return Response.json({ sent: true });
}
