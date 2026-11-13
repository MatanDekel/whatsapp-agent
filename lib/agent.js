import Anthropic from '@anthropic-ai/sdk';
import * as store from './store.js';
import * as rem from './reminders.js';
import { sharingFamily } from './users.js';
import { appTools, connectedApps, runAppTool } from './apps/index.js';
import * as google from './google.js';

const client = new Anthropic();
const MODEL_SMART = process.env.MODEL_SMART || process.env.MODEL || 'claude-sonnet-5-5';
const MODEL_FAST = process.env.MODEL_FAST || 'claude-haiku-5-5';
const ESCALATE = {
  name: 'escalate_to_smart_model',
  description:
    'העבר את הבקשה למודל חזק יותר. השתמש בזה רק אם הבקשה באמת מורכבת: תכנון של כמה שלבים, ' +
    'השוואת לוחות זמנים, ניתוח, כתיבה ארוכה או רגישה, או כשאתה לא בטוח שתענה נכון. ' +
    'לבקשות פשוטות (תזכורת, פתק, שאלה קצרה) — אל תשתמש.',
  input_schema: { type: 'object', properties: { reason: { type: 'string' } } },
};
const TZ = process.env.TZ_NAME || 'Asia/Jerusalem';

const baseTools = [
  {
    name: 'save_note',
    description: 'שמירת פתק/מידע לזיכרון ארוך טווח (העדפות, פרטים חשובים, רעיונות).',
    input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
  { name: 'list_notes', description: 'הצגת כל הפתקים השמורים.', input_schema: { type: 'object', properties: {} } },
  {
    name: 'delete_note',
    description: 'מחיקת פתק לפי id.',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'add_task',
    description: 'הוספת משימה לרשימת המשימות של הסוכן (נכנסת לסיכום הבוקר).',
    input_schema: {
      type: 'object',
      properties: { title: { type: 'string' }, due: { type: 'string', description: 'YYYY-MM-DD, אופציונלי' } },
      required: ['title'],
    },
  },
  { name: 'list_tasks', description: 'הצגת משימות פתוחות.', input_schema: { type: 'object', properties: {} } },
  {
    name: 'complete_task',
    description: 'סימון משימה כבוצעה (מוחק אותה) לפי id.',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'schedule_reminder',
    description: 'קביעת תזכורת שתישלח למשתמש כהודעת וואטסאפ בזמן שנקבע. ברירת המחדל ל"תזכיר לי".',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'מה להזכיר, בניסוח קצר' },
        when: { type: 'string', description: 'זמן מקומי YYYY-MM-DD HH:mm' },
      },
      required: ['text', 'when'],
    },
  },
  { name: 'list_reminders', description: 'תזכורות וואטסאפ עתידיות.', input_schema: { type: 'object', properties: {} } },
  {
    name: 'cancel_reminder',
    description: 'ביטול תזכורת לפי id.',
    input_schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
  },
  {
    name: 'get_schedule',
    description: 'הלו"ז של המשתמש מהיומן באייפון (מסונכרן). בלי פרמטרים: 7 הימים הקרובים.',
    input_schema: {
      type: 'object',
      properties: { from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' } },
    },
  },
  {
    name: 'phone_action',
    description:
      'פעולה באייפון דרך Shortcuts: תזכורת באפליקציית Reminders, אירוע חדש ביומן, או פתיחת קישור. ' +
      'השתמש ב-reminder רק אם ביקשו במפורש תזכורת באפליקציה; אחרת schedule_reminder.',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['reminder', 'calendar', 'open_url'] },
        title: { type: 'string' },
        date: { type: 'string', description: 'זמן מקומי בפורמט YYYY-MM-DD HH:mm (התחלה / זמן התראה)' },
        end_date: { type: 'string', description: 'לאירועים: זמן סיום, YYYY-MM-DD HH:mm' },
        location: { type: 'string' },
        notes: { type: 'string' },
        url: { type: 'string' },
      },
      required: ['type', 'title'],
    },
  },
];

function toolsFor(user) {
  const tools = [...baseTools];
  const family = sharingFamily(user);
  if (family.length) {
    tools.push({
      name: 'get_family_schedule',
      description:
        'הלו"ז של בני משפחה שבחרו לשתף אותו. בלי member: כל מי שמשתף. ' +
        `בני משפחה זמינים: ${family.map((u) => u.name).join(', ')}.`,
      input_schema: {
        type: 'object',
        properties: {
          member: { type: 'string', description: 'שם בן המשפחה, אופציונלי' },
          from: { type: 'string', description: 'YYYY-MM-DD' },
          to: { type: 'string', description: 'YYYY-MM-DD' },
        },
      },
    });
  }
  tools.push(...appTools(user));
  if (google.configured()) {
    tools.push({
      name: 'connect_google_calendar',
      description: 'יוצר קישור אישי לחיבור (או חיבור מחדש) של יומן Google. שלח למשתמש את הקישור כמו שהוא.',
      input_schema: { type: 'object', properties: {} },
    });
    tools.push({
      name: 'calendar_add_event',
      description:
        'הוספת אירוע ליומן Google של המשתמש (עובד רק אם היומן מחובר). start: "YYYY-MM-DD HH:mm" בשעון ישראל, ' +
        'או "YYYY-MM-DD" לאירוע של יום שלם. end או durationMinutes אופציונליים (ברירת מחדל שעה).',
      input_schema: {
        type: 'object',
        properties: {
          title: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' },
          durationMinutes: { type: 'number' }, location: { type: 'string' }, description: { type: 'string' },
        },
        required: ['title', 'start'],
      },
    });
  }
  if (process.env.ENABLE_WEB_SEARCH !== 'false') {
    tools.push({ type: 'web_search_20250305', name: 'web_search', max_uses: 3 });
  }
  return tools;
}

async function familySchedule(user, { member, from, to }) {
  let family = sharingFamily(user);
  if (member) {
    const m = String(member).trim();
    family = family.filter((u) => u.name.includes(m) || m.includes(u.name) || u.id === m);
    if (!family.length) return { error: 'בן המשפחה לא נמצא או שלא בחר לשתף את הלו"ז שלו' };
  }
  const out = {};
  for (const u of family) { await google.syncIfStale(u.id); out[u.name] = await rem.getSchedule(u.id, from, to); }
  return out;
}

async function runTool(user, name, input) {
  const uid = user.id;
  switch (name) {
    case 'save_note': return store.addNote(uid, input.text);
    case 'list_notes': return store.listNotes(uid);
    case 'delete_note': await store.deleteNote(uid, input.id); return { deleted: input.id };
    case 'add_task': return store.addTask(uid, input.title, input.due);
    case 'list_tasks': return store.listTasks(uid);
    case 'complete_task': await store.completeTask(uid, input.id); return { completed: input.id };
    case 'schedule_reminder': return rem.scheduleReminder(uid, input.text, input.when);
    case 'list_reminders': return rem.listReminders(uid);
    case 'cancel_reminder': return rem.cancelReminder(uid, input.id);
    case 'get_schedule': {
      await google.syncIfStale(uid);
      const sched = await rem.getSchedule(uid, input.from, input.to);
      if (google.configured() && !(await google.isConnected(uid))) {
        sched.googleCalendar = 'לא מחובר. הדרך לחבר: קרא ל-connect_google_calendar ושלח למשתמש את הקישור. אל תפנה ל-Shortcut באייפון.';
      }
      return sched;
    }
    case 'connect_google_calendar': return { link: google.authUrl(uid), note: 'הקישור תקף לשעה' };
    case 'calendar_add_event':
      if (!(await google.isConnected(uid))) return { error: 'יומן Google לא מחובר. הצע לחבר עם connect_google_calendar.' };
      return google.createEvent(uid, input);
    case 'get_family_schedule': return familySchedule(user, input);
    case 'phone_action': await store.queueAction(uid, input); return { queued: true };
    default: {
      const r = runAppTool(user, name, input);
      return r === undefined ? { error: `unknown tool ${name}` } : r;
    }
  }
}

function systemPrompt(user, channel, notes = [], googleConnected = false) {
  const now = new Intl.DateTimeFormat('he-IL', { timeZone: TZ, dateStyle: 'full', timeStyle: 'short' }).format(new Date());
  const channelNote = {
    whatsapp:
      'אתה עונה בוואטסאפ: תשובות קצרות, בלי Markdown של כותרות. אפשר *מודגש* ו-_נטוי_ בסגנון וואטסאפ. ' +
      'פעולות phone_action ייכנסו לתור ויתבצעו באייפון בסנכרון הבא של ה-Shortcut — ציין זאת בקצרה.',
    iphone: 'המשתמש מדבר איתך מ-Shortcut באייפון (ייתכן שהתשובה תוקרא בקול). ענה במשפט-שניים. פעולות phone_action יתבצעו מיד.',
    cron: 'זו הרצה אוטומטית ללא משתמש פעיל. כתוב את הסיכום בלבד, בלי שאלות ובלי פתיח.',
  }[channel] || '';
  const address = user.gender === 'f' ? 'פנה אליה בלשון נקבה.' : user.gender === 'm' ? 'פנה אליו בלשון זכר.' : '';
  const family = sharingFamily(user);
  const familyNote = family.length
    ? `בני משפחה שמשתפים איתך את הלו"ז שלהם: ${family.map((u) => u.name).join(', ')}. ` +
      'אפשר לבדוק מה הם עושים עם get_family_schedule. מידע אחר שלהם (פתקים, משימות, שיחות) לא זמין לך.'
    : '';
  const known = notes.length
    ? 'מה שאתה כבר יודע על המשתמש (מהפתקים השמורים):\n' +
      notes.slice(-40).map((n) => `- [${n.id}] ${n.text}`).join('\n')
    : 'עדיין אין פתקים שמורים על המשתמש.';
  const apps = connectedApps(user);
  const appsNote = apps.length
    ? `אפליקציות משפחתיות מחוברות: ${apps.join(', ')}. כשמבקשים להוסיף לרשימה, לבדוק מטלות או מתכון — עבוד ישירות מולן, ` +
      'ואחרי שינוי אמור בקצרה מה עשית. כשמבקשים "מה צריך בשביל מתכון X" — קרא את המתכון ושאל אם להוסיף את המצרכים לרשימה. ' +
      'מטלות בית משותפות (ניקיון, כביסה, פח) — chores_*; משימות אישיות של המשתמש — add_task.'
    : '';
  const googleNote = !google.configured() ? '' : googleConnected
    ? 'יומן Google של המשתמש מחובר: הלו"ז מגיע ממנו, ואירועים חדשים מוסיפים עם calendar_add_event (לא phone_action).'
    : 'חשוב: יומן Google של המשתמש עוד לא מחובר. כשהוא שואל על הלו"ז, על היומן או על סנכרון — קרא מיד ל-connect_google_calendar ' +
      'ושלח לו את הקישור לחיבור. זו הדרך היחידה לחבר יומן; אל תציע Shortcut באייפון ואל תגיד שאין לך דרך לחבר. ' +
      'אם בשיחה הקודמת נאמר אחרת — זה כבר לא נכון.';
  return `אתה סוכן אישי של ${user.name}. האדם שמדבר איתך עכשיו הוא ${user.name} — אם שואלים "מי אני", זה השם.
ענה בעברית אלא אם פנו אליך בשפה אחרת. ${address}
${known}
כשהמשתמש מספר משהו אישי שכדאי לזכור לאורך זמן (עבודה, העדפות, אנשים בחייו, תחביבים, שגרה) — שמור אותו עם save_note בלי לבקש רשות, ובקצרה ציין ששמרת. אל תשמור דברים חולפים.
אם פרט שמור השתנה — מחק את הפתק הישן (delete_note) ושמור את החדש.
${familyNote}
${appsNote}
${googleNote}
עכשיו: ${now} (אזור זמן ${TZ}).
יש לך כלים לפתקים, משימות ופעולות באייפון. השתמש בהם כשזה עוזר, ואל תמציא שביצעת פעולה שלא ביצעת.
כשמבקשים "תזכיר/תזכירי לי" — schedule_reminder (נשלח בוואטסאפ). אם הזמן לא ברור, שאל; אם נאמר רק יום, הצע שעה סבירה ואשר.
כשמבקשים תזכורת יחסית לאירוע ("שעה לפני הפגישה") — בדוק קודם ב-get_schedule.
כששואלים על הלו"ז, או כשמתכננים משהו — השתמש ב-get_schedule. אם הסנכרון ישן מיום, ציין זאת.
${channelNote}`;
}

const textOf = (res) => res.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
const shape = (res) => res.content.map((b) => b.type + (b.name ? `:${b.name}` : '') + (b.type === 'text' ? `(${b.text.length})` : ''));

export async function runAgent({ user, channel, text, saveHistory = true }) {
  const history = saveHistory ? await store.getHistory(user.id) : [];
  const notes = await store.listNotes(user.id);
  const googleConnected = await google.isConnected(user.id);
  const system = systemPrompt(user, channel, notes, googleConnected);

  let model = channel === 'cron' ? MODEL_SMART : MODEL_FAST;
  const messages = [...history, { role: 'user', content: text }];
  let reply = '';
  let tools = [];

  for (let i = 0; i < 8; i++) {
    tools = toolsFor(user);
    if (model === MODEL_FAST) tools.push(ESCALATE);
    const res = await client.messages.create({ model, max_tokens: 2048, system, tools, messages });
    console.log('agent step', { user: user.id, i, model, stop: res.stop_reason, content: shape(res) });

    const esc = res.content.find((b) => b.type === 'tool_use' && b.name === ESCALATE.name);
    if (esc) {
      console.log('escalating to smart model', { user: user.id, reason: esc.input?.reason });
      model = MODEL_SMART; // התור הזה נזרק; המודל החזק ממשיך מאותה נקודה
      continue;
    }

    messages.push({ role: 'assistant', content: res.content });
    if (res.stop_reason === 'pause_turn') continue;
    if (res.stop_reason !== 'tool_use') {
      reply = textOf(res);
      break;
    }

    const results = [];
    for (const block of res.content) {
      if (block.type !== 'tool_use') continue;
      let out;
      try { out = await runTool(user, block.name, block.input); }
      catch (e) { console.error('tool failed', { tool: block.name, error: e.message }); out = { error: e.message }; }
      results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(out ?? null) });
    }
    messages.push({ role: 'user', content: results });
  }

  // אם לא יצאה תשובה — סבב אחרון בלי כלים, שבו המודל חייב לכתוב תשובה
  if (!reply) {
    if (messages[messages.length - 1].role === 'assistant') {
      messages.push({ role: 'user', content: '(הודעת מערכת: כתוב עכשיו תשובה קצרה למשתמש על בסיס מה שעשית ומה שמצאת.)' });
    }
    try {
      const res = await client.messages.create({
        model: MODEL_SMART, max_tokens: 1024, system, tools: toolsFor(user), tool_choice: { type: 'none' }, messages,
      });
      console.log('agent final step', { user: user.id, stop: res.stop_reason, content: shape(res) });
      reply = textOf(res);
    } catch (e) {
      console.error('final step failed', e.message);
    }
  }
  console.log('agent reply', { user: user.id, model, empty: !reply });

  reply ||= 'סליחה, משהו השתבש. נסה שוב.';
  if (saveHistory) await store.appendHistory(user.id, text, reply);
  return { reply };
}
