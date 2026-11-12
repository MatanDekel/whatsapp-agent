import { runAgent } from '../../lib/agent.js';
import { promoteDistantReminders } from '../../lib/reminders.js';
import { syncIfStale } from '../../lib/google.js';
import { getUsers, sharingFamily } from '../../lib/users.js';
import { notifyUser } from '../../lib/whatsapp.js';

// Vercel Cron — סיכום בוקר לכל משתמש בנפרד
export async function GET(request) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('unauthorized', { status: 401 });
  }
  const results = {};
  for (const user of getUsers()) {
    try {
      await promoteDistantReminders(user.id);
      await syncIfStale(user.id, 0);
      const familyLine = sharingFamily(user).length
        ? ' בסוף, שורה קצרה על מה שיש היום לבני המשפחה שמשתפים לו"ז (get_family_schedule), רק אם יש משהו.'
        : '';
      const { reply } = await runAgent({
        user,
        channel: 'cron',
        saveHistory: false,
        text:
          'הכן סיכום בוקר קצר: הלו"ז של היום (get_schedule להיום), משימות להיום ובאיחור, ' +
          'ותזכורות שמתוכננות להיום. עד 8 שורות. אם אין כלום — כתוב בוקר טוב קצר.' + familyLine,
      });
      await notifyUser(user, reply);
      results[user.id] = 'sent';
    } catch (e) {
      console.error('daily failed for', user.id, e);
      results[user.id] = 'error';
    }
  }
  return Response.json(results);
}
