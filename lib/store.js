import { Redis } from '@upstash/redis';
import { randomUUID } from 'node:crypto';

export const redis = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

// כל המפתחות מופרדים לפי משתמש
export const key = (uid, name) => `u:${uid}:${name}`;
const id = () => randomUUID().slice(0, 8);
const HISTORY_MAX = 20;

// --- היסטוריית שיחה ---
export async function getHistory(uid) {
  const items = (await redis.lrange(key(uid, 'hist'), 0, -1)) || [];
  while (items.length && items[0].role !== 'user') items.shift();
  return items;
}
export async function appendHistory(uid, userText, assistantText) {
  await redis.rpush(key(uid, 'hist'), { role: 'user', content: userText }, { role: 'assistant', content: assistantText });
  await redis.ltrim(key(uid, 'hist'), -HISTORY_MAX, -1);
}
export const clearHistory = (uid) => redis.del(key(uid, 'hist'));

// --- פתקים ---
export async function addNote(uid, text) {
  const n = { id: id(), text, created: new Date().toISOString() };
  await redis.hset(key(uid, 'notes'), { [n.id]: n });
  return n;
}
export async function listNotes(uid) {
  return Object.values((await redis.hgetall(key(uid, 'notes'))) || {});
}
export const deleteNote = (uid, noteId) => redis.hdel(key(uid, 'notes'), noteId);

// --- משימות ---
export async function addTask(uid, title, due) {
  const t = { id: id(), title, due: due || null, created: new Date().toISOString() };
  await redis.hset(key(uid, 'tasks'), { [t.id]: t });
  return t;
}
export async function listTasks(uid) {
  return Object.values((await redis.hgetall(key(uid, 'tasks'))) || {});
}
export const completeTask = (uid, taskId) => redis.hdel(key(uid, 'tasks'), taskId);

// --- תור פעולות לאייפון ---
export const queueAction = (uid, action) => redis.rpush(key(uid, 'actions'), { id: id(), ...action });
export async function drainActions(uid) {
  return (await redis.lpop(key(uid, 'actions'), 50)) || [];
}

// --- וואטסאפ ---
export async function markSeen(messageId) {
  return (await redis.set(`seen:${messageId}`, 1, { nx: true, ex: 86400 })) === 'OK';
}
export const setLastInbound = (uid) => redis.set(key(uid, 'last_inbound'), Date.now());
export async function getLastInbound(uid) {
  return Number((await redis.get(key(uid, 'last_inbound'))) || 0);
}
