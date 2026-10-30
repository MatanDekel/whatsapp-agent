import { eventStillExists, formatLocal, takeReminder, verifyQStash } from '../lib/reminders.js';
import { notifyOwner } from '../lib/whatsapp.js';

// QStash קורא לכאן בזמן התזכורת
export async function POST(request) {
  const raw = await request.text();
  if (!(await verifyQStash(raw, request.headers.get('upstash-signature')))) {
    return new Response('bad signature', { status: 401 });
  }
  const job = JSON.parse(raw);

  if (job.kind === 'manual') {
    const r = await takeReminder(job.id);
    if (!r) return Response.json({ skipped: 'cancelled' });
    await notifyOwner(`⏰ תזכורת: ${r.text}`);
  }

  if (job.kind === 'event') {
    if (!(await eventStillExists(job.title, job.start))) return Response.json({ skipped: 'event changed' });
    const where = job.location ? ` (${job.location})` : '';
    await notifyOwner(`📅 בעוד ${job.lead} דק׳: ${job.title}${where}, ${formatLocal(job.start)}`);
  }

  return Response.json({ sent: true });
}
