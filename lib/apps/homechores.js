import { FieldValue } from 'firebase-admin/firestore';
import { fb, norm, uidByEmail } from './firebase.js';

// חישובי תאריכים כמו בדפדפן של המשתמשים — לפי שעון ישראל
process.env.TZ = process.env.TZ_NAME || 'Asia/Jerusalem';

export const enabled = (user) => Boolean(user.email && process.env.FIREBASE_HOMECHORES_KEY);

// ── מועתק מ-HomeChores/src/App.jsx כדי שהחישוב יהיה זהה לאפליקציה ──
function dateKey(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function weekKey(d) { const dt = d || new Date(); const sunday = new Date(dt); sunday.setDate(dt.getDate() - dt.getDay()); return `week-${dateKey(sunday)}`; }
function isTaskDue(task, date) {
  const created = new Date(task.createdAt?.toDate?.() ?? task.createdAt);
  created.setHours(0, 0, 0, 0);
  const target = new Date(date); target.setHours(0, 0, 0, 0);
  if (target < created) return false;
  const unit = task.repeatUnit || (task.repeat === 'once' ? 'once' : task.repeat === 'daily' ? 'days' : task.repeat === 'weekly' ? 'weeks' : 'months');
  const every = task.repeatEvery || 1;
  if (unit === 'once') return dateKey(created) === dateKey(target);
  if (unit === 'days') return Math.round((target - created) / 86400000) % every === 0;
  if (unit === 'weeks') {
    const diffDays = Math.round((target - created) / 86400000);
    if (task.weekDays && task.weekDays.length > 0) {
      if (!task.weekDays.includes(target.getDay())) return false;
      const dayOffset = ((target.getDay() - created.getDay()) + 7) % 7;
      return diffDays >= dayOffset && (diffDays - dayOffset) % (every * 7) === 0;
    }
    return diffDays % (every * 7) === 0;
  }
  if (unit === 'months') {
    const ym = (target.getFullYear() - created.getFullYear()) * 12 + (target.getMonth() - created.getMonth());
    if (ym < 0 || ym % every !== 0) return false;
    if (task.monthMode === 'weekday' && task.monthWeekDay != null && task.monthWeekNum) {
      if (target.getDay() !== task.monthWeekDay) return false;
      const firstOfMonth = new Date(target.getFullYear(), target.getMonth(), 1);
      const firstOccurrence = ((task.monthWeekDay - firstOfMonth.getDay() + 7) % 7) + 1;
      return Math.floor((target.getDate() - firstOccurrence) / 7) + 1 === task.monthWeekNum;
    }
    return target.getDate() === (task.monthDay || created.getDate());
  }
  if (unit === 'years') { const yy = target.getFullYear() - created.getFullYear(); return yy % every === 0 && target.getMonth() === created.getMonth() && target.getDate() === created.getDate(); }
  return false;
}
// ─────────────────────────────────────────────────────────────────────

function parseDate(s) {
  if (!s) return new Date();
  const [y, m, d] = String(s).split('-').map(Number);
  return new Date(y, m - 1, d);
}

async function load(user) {
  const conn = fb('homechores', 'FIREBASE_HOMECHORES_KEY');
  const uid = await uidByEmail(conn, user.email);
  const prof = await conn.db.doc(`users/${uid}`).get();
  const hid = prof.exists ? prof.data().householdId : null;
  if (!hid) throw new Error('החשבון לא משויך לבית ב-HomeChores');
  const base = conn.db.doc(`households/${hid}`);
  const [hh, tasks, areas, done, weekly] = await Promise.all([
    base.get(), base.collection('tasks').get(), base.collection('areas').get(),
    base.collection('done').doc('state').get(), base.collection('done').doc('weekly').get(),
  ]);
  return {
    conn, uid, base,
    members: hh.data()?.members || [],
    tasks: tasks.docs.map((d) => ({ id: d.id, ...d.data() })),
    areas: areas.docs.map((d) => ({ id: d.id, ...d.data() })),
    done: done.exists ? done.data() : {},
    weekly: weekly.exists ? weekly.data() : {},
  };
}

const firstName = (n) => String(n || '').split(' ')[0];

function describe(h, t, isDone) {
  const area = h.areas.find((a) => a.id === t.areaId);
  const who = (t.assignedTo || []).map((id) => firstName(h.members.find((m) => m.id === id)?.name)).filter(Boolean);
  return {
    id: t.id, title: `${t.emoji || ''} ${t.title}`.trim(), area: area?.name,
    time: t.timeOfDay && t.timeOfDay !== 'anytime' ? t.timeOfDay : undefined,
    assignedTo: who.length ? who : 'כולם', done: Boolean(isDone),
  };
}

// מטלות ליום מסוים + המטלות השבועיות הגמישות
export async function choresFor(user, { date, onlyMine } = {}) {
  const h = await load(user);
  const d = parseDate(date);
  const mine = (t) => !onlyMine || !(t.assignedTo || []).length || t.assignedTo.includes(h.uid);
  const dayDone = h.done[dateKey(d)] || {};
  const weekDone = h.weekly[weekKey(d)] || {};
  return {
    date: dateKey(d),
    daily: h.tasks.filter((t) => t.taskType !== 'weekly' && isTaskDue(t, d) && mine(t)).map((t) => describe(h, t, dayDone[t.id])),
    weekly: h.tasks.filter((t) => t.taskType === 'weekly' && mine(t)).map((t) => describe(h, t, weekDone[t.id])),
  };
}

export async function markDone(user, { task, date, done = true }) {
  const h = await load(user);
  const d = parseDate(date);
  const q = norm(task);
  let matches = h.tasks.filter((t) => t.id === task || norm(t.title) === q);
  if (!matches.length) matches = h.tasks.filter((t) => norm(t.title).includes(q) || q.includes(norm(t.title)));
  const dueToday = matches.filter((t) => t.taskType === 'weekly' || isTaskDue(t, d));
  if (dueToday.length) matches = dueToday;
  if (!matches.length) return { error: 'לא מצאתי מטלה כזו', available: h.tasks.map((t) => t.title) };
  if (matches.length > 1) return { error: 'יש כמה מטלות מתאימות — איזו?', options: matches.map((t) => t.title) };
  const t = matches[0];
  const weeklyTask = t.taskType === 'weekly';
  const key = weeklyTask ? weekKey(d) : dateKey(d);
  await h.base.collection('done').doc(weeklyTask ? 'weekly' : 'state').set({ [key]: { [t.id]: Boolean(done) } }, { merge: true });
  return { task: t.title, done: Boolean(done), for: weeklyTask ? 'השבוע' : key };
}

export async function addChore(user, input) {
  const h = await load(user);
  const today = new Date();
  const unit = ['once', 'days', 'weeks', 'months', 'years'].includes(input.repeatUnit) ? input.repeatUnit : 'weeks';
  const area = (input.area && h.areas.find((a) => norm(a.name).includes(norm(input.area)))) || h.areas[0];
  const assignedTo = (input.assignees || [])
    .map((n) => h.members.find((m) => norm(m.name).includes(norm(n)) || norm(m.email) === norm(n))?.id)
    .filter(Boolean);
  const ref = h.base.collection('tasks').doc();
  const task = {
    id: ref.id, title: String(input.title).trim(), emoji: input.emoji || '🧹', areaId: area?.id || '',
    depth: 'Quick Tidy', taskType: input.taskType === 'weekly' ? 'weekly' : 'daily',
    timeOfDay: ['morning', 'evening'].includes(input.timeOfDay) ? input.timeOfDay : 'anytime',
    assignedTo, repeatUnit: unit, repeatEvery: Number(input.repeatEvery) || 1,
    weekDays: unit === 'weeks' ? (input.weekDays?.length ? input.weekDays.map(Number) : [today.getDay()]) : null,
    monthDay: unit === 'months' ? Number(input.monthDay) || today.getDate() : null,
    monthMode: unit === 'months' ? 'date' : null, monthWeekDay: null, monthWeekNum: null,
    notes: input.notes || '', createdBy: h.uid, createdAt: FieldValue.serverTimestamp(),
  };
  await ref.set(task);
  return { added: task.title, area: area?.name, assignedTo: assignedTo.length ? input.assignees : 'כולם' };
}

export async function check(user) {
  const h = await load(user);
  return { projectId: h.conn.projectId, tasks: h.tasks.length, members: h.members.length };
}
