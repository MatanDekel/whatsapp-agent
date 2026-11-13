import { getMorning } from '../../lib/morning.js';
import { sendMorning } from '../../lib/morning-send.js';
import { promoteDistantReminders } from '../../lib/reminders.js';
import { getUsers } from '../../lib/users.js';

// Vercel Cron — תחזוקה יומית + הודעת בוקר למי שלא קבע שעה משלו
export async function GET(request) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('unauthorized', { status: 401 });
  }
  const results = {};
  for (const user of getUsers()) {
    try {
      await promoteDistantReminders(user.id);
      const cfg = await getMorning(user.id);
      if (cfg?.enabled === false) { results[user.id] = 'off'; continue; }
      if (cfg?.scheduleId) { results[user.id] = 'own schedule'; continue; }
      await sendMorning(user, cfg);
      results[user.id] = 'sent';
    } catch (e) {
      console.error('daily failed for', user.id, e);
      results[user.id] = 'error';
    }
  }
  return Response.json(results);
}
