import { runAgent } from './agent.js';
import { syncIfStale } from './google.js';
import { buildPrompt, getMorning } from './morning.js';
import { sharingFamily } from './users.js';
import { notifyUser } from './whatsapp.js';

export async function sendMorning(user, cfg) {
  cfg = cfg ?? (await getMorning(user.id));
  await syncIfStale(user.id, 0);
  const familyLine = sharingFamily(user).length
    ? ' בסוף, שורה קצרה על מה שיש היום לבני המשפחה שמשתפים לו"ז (get_family_schedule), רק אם יש משהו.'
    : '';
  const { reply } = await runAgent({ user, channel: 'cron', saveHistory: false, text: buildPrompt(cfg, familyLine) });
  await notifyUser(user, reply);
}
