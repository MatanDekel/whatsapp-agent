import { waitUntil } from '@vercel/functions';
import { runAgent } from '../lib/agent.js';
import { clearHistory, markSeen, setLastInbound } from '../lib/store.js';
import { markRead, sendText, validSignature } from '../lib/whatsapp.js';

const digits = (s) => String(s || '').replace(/\D/g, '');

// אימות webhook מול Meta
export function GET(request) {
  const p = new URL(request.url).searchParams;
  if (p.get('hub.mode') === 'subscribe' && p.get('hub.verify_token') === process.env.WA_VERIFY_TOKEN) {
    return new Response(p.get('hub.challenge'));
  }
  return new Response('forbidden', { status: 403 });
}

export async function POST(request) {
  const raw = await request.text();
  const sig = request.headers.get('x-hub-signature-256');
  if (!validSignature(raw, sig)) {
    const secret = (process.env.WA_APP_SECRET || '').trim();
    console.warn('Signature check failed', {
      hasHeader: Boolean(sig),
      secretSet: Boolean(secret),
      secretLength: secret.length, // App Secret תקין הוא באורך 32
      secretHasSpaces: secret !== (process.env.WA_APP_SECRET || ''),
    });
    return new Response('bad signature', { status: 401 });
  }
  // עונים ל-Meta מיד, ומעבדים ברקע
  waitUntil(handle(JSON.parse(raw)).catch((e) => console.error('handle failed', e)));
  return new Response('ok');
}

async function handle(body) {
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const msg of change.value?.messages ?? []) {
        if (digits(msg.from) !== digits(process.env.OWNER_NUMBER)) continue; // רק אתה
        if (!(await markSeen(msg.id))) continue; // Meta לפעמים שולחת פעמיים
        await setLastInbound();
        markRead(msg.id).catch(() => {});

        if (msg.type !== 'text') {
          await sendText(msg.from, 'כרגע אני מבין רק הודעות טקסט 🙂');
          continue;
        }
        const text = msg.text.body.trim();
        if (text === '/reset') {
          await clearHistory();
          await sendText(msg.from, 'ההיסטוריה נמחקה ✅');
          continue;
        }
        const { reply } = await runAgent({ channel: 'whatsapp', text });
        await sendText(msg.from, reply);
      }
    }
  }
}
