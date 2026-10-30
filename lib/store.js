import { Redis } from '@upstash/redis';
import { randomUUID } from 'node:crypto';

export const redis = new Redis({
  url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN,
});

const id = () => randomUUID().slice(0, 8);
const HISTORY_MAX = 20;

// --- היסטוריית שיחה (רק טקסט, בזוגות user/assistant) ---
export async function getHistory() {
  const items = (await redis.lrange('hist', 0, -1)) || [];
  while (items.length && items[0].role !== 'user') items.shift();
  return items;
}
export async function appendHistory(userText, assistantText) {
  await redis.rpush('hist', { role: 'user', content: userText }, { role: 'assistant', content: assistantText });
  await redis.ltrim('hist', -HISTORY_MAX, -1);
}
export const clearHistory = () => redis.del('hist');

// --- פתקים ---
export async function addNote(text) {
  const n = { id: id(), text, created: new Date().toISOString() };
  await redis.hset('notes', { [n.id]: n });
  return n;
}
export async function listNotes() {
  return Object.values((await redis.hgetall('notes')) || {});
}
export const deleteNote = (noteId) => redis.hdel('notes', noteId);

// --- משימות ---
export async function addTask(title, due) {
  const t = { id: id(), title, due: due || null, created: new Date().toISOString() };
  await redis.hset('tasks', { [t.id]: t });
  return t;
}
export async function listTasks() {
  return Object.values((await redis.hgetall('tasks')) || {});
}
export const completeTask = (taskId) => redis.hdel('tasks', taskId);

// --- תור פעולות לאייפון (מבוצעות ע"י Shortcuts) ---
export const queueAction = (action) => redis.rpush('actions', { id: id(), ...action });
export async function drainActions() {
  return (await redis.lpop('actions', 50)) || [];
}

// --- וואטסאפ: מניעת כפילויות וחלון 24 שעות ---
export async function markSeen(messageId) {
  return (await redis.set(`seen:${messageId}`, 1, { nx: true, ex: 86400 })) === 'OK';
}
export const setLastInbound = () => redis.set('last_inbound', Date.now());
export async function getLastInbound() {
  return Number((await redis.get('last_inbound')) || 0);
}
