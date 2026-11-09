import { createHmac, timingSafeEqual } from 'node:crypto';
import { getLastInbound } from './store.js';

const url = () =>
  `https://graph.facebook.com/${process.env.GRAPH_VERSION || 'v21.0'}/${process.env.WA_PHONE_NUMBER_ID}/messages`;

async function call(body) {
  const r = await fetch(url(), {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.WA_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...body }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`WhatsApp ${data?.error?.code}: ${data?.error?.message}`);
  return data;
}

export const sendText = (to, text) =>
  call({ to, type: 'text', text: { body: String(text).slice(0, 4096) } });

export const markRead = (messageId) => call({ status: 'read', message_id: messageId });

export function sendTemplate(to, text) {
  // פרמטר בתבנית לא יכול להכיל שורות חדשות
  const param = String(text).replace(/\s*\n+\s*/g, ' • ').replace(/ {4,}/g, ' ').slice(0, 900);
  return call({
    to,
    type: 'template',
    template: {
      name: process.env.WA_TEMPLATE_NAME || 'agent_update',
      language: { code: process.env.WA_TEMPLATE_LANG || 'he' },
      components: [{ type: 'body', parameters: [{ type: 'text', text: param }] }],
    },
  });
}

// הודעה יזומה: טקסט חופשי בתוך חלון 24 שעות, תבנית מחוצה לו
export async function notifyUser(user, text) {
  const inWindow = Date.now() - (await getLastInbound(user.id)) < 23 * 3600 * 1000;
  return inWindow ? sendText(user.phone, text) : sendTemplate(user.phone, text);
}

export function validSignature(rawBody, header) {
  const secret = (process.env.WA_APP_SECRET || '').trim();
  if (!header || !secret) return false;
  const expected = 'sha256=' + createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}
