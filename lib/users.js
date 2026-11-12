// משתמשים מוגדרים במשתנה הסביבה USERS (JSON). כל משתמש = סוכן נפרד לגמרי.
// דוגמה:
// [{"id":"eden","name":"עדן","phone":"9725XXXXXXXX","token":"...","gender":"f","family":"home","shareSchedule":true}]
const digits = (s) => String(s || '').replace(/\D/g, '');
let cache;

export function getUsers() {
  if (cache) return cache;
  let list = [];
  if (process.env.USERS) {
    try { list = JSON.parse(process.env.USERS); }
    catch (e) { console.error('USERS is not valid JSON:', e.message); }
  }
  // תאימות לאחור: משתמש יחיד לפי OWNER_NUMBER
  if (!list.length && process.env.OWNER_NUMBER) {
    list = [{ id: 'owner', phone: process.env.OWNER_NUMBER, token: process.env.SHORTCUT_TOKEN }];
  }
  cache = list.map((u) => ({
    id: String(u.id),
    name: u.name || String(u.id),
    email: String(u.email || '').trim().toLowerCase(),
    phone: digits(u.phone),
    token: String(u.token || ''),
    gender: u.gender === 'm' ? 'm' : u.gender === 'f' ? 'f' : null,
    family: u.family || null,
    shareSchedule: u.shareSchedule === true, // האם בני משפחה יכולים לראות את הלו"ז שלי
  }));
  return cache;
}

export const userByPhone = (phone) => getUsers().find((u) => u.phone && u.phone === digits(phone));
export const userById = (id) => getUsers().find((u) => u.id === id);

export function userFromRequest(request) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  return token ? getUsers().find((u) => u.token && u.token === token) : undefined;
}

// בני משפחה שבחרו לשתף את הלו"ז שלהם
export function sharingFamily(user) {
  if (!user.family) return [];
  return getUsers().filter((u) => u.id !== user.id && u.family === user.family && u.shareSchedule);
}
