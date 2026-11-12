import * as cart from './smartcart.js';
import * as chores from './homechores.js';
import * as recipes from './recipes.js';

const S = (properties, required = []) => ({ type: 'object', properties, required });
const names = { type: 'array', items: { type: 'string' } };

const CART = [
  { name: 'shopping_list_get', description: 'רשימת הקניות המשפחתית ב-SmartCart: מה צריך לקנות, כמויות, ומה כבר נקנה. מחזיר גם את רשימת הקטגוריות.', input_schema: S({}) },
  {
    name: 'shopping_list_add',
    description:
      'הוספת מוצרים לרשימת הקניות ב-SmartCart. amount: מספר יחידות, ובמוצרי בשר/עוף — גרמים (1 ק"ג = 1000). ' +
      'category: אחת הקטגוריות הקיימות (קבל אותן מ-shopping_list_get אם אינך בטוח); מוצר שכבר קיים נשאר בקטגוריה שלו.',
    input_schema: S({ items: { type: 'array', items: S({ name: { type: 'string' }, amount: { type: 'number' }, category: { type: 'string' }, note: { type: 'string' } }, ['name']) } }, ['items']),
  },
  { name: 'shopping_list_remove', description: 'הסרת מוצרים מרשימת הקניות.', input_schema: S({ names }, ['names']) },
  { name: 'shopping_mark_bought', description: 'סימון מוצרים כ"נקנה" ברשימה (bought=false מבטל סימון).', input_schema: S({ names, bought: { type: 'boolean' } }, ['names']) },
  { name: 'shopping_clear_bought', description: 'ניקוי כל המוצרים שסומנו כנקנו מהרשימה (סיום קנייה). רק כשהמשתמש מבקש במפורש.', input_schema: S({}) },
];

const CHORES = [
  {
    name: 'chores_get',
    description: 'מטלות הבית מ-HomeChores ליום מסוים (ברירת מחדל: היום), כולל המטלות השבועיות הגמישות, מי אחראי ומה כבר בוצע. onlyMine=true רק מטלות של המשתמש (וכאלה של כולם).',
    input_schema: S({ date: { type: 'string', description: 'YYYY-MM-DD' }, onlyMine: { type: 'boolean' } }),
  },
  {
    name: 'chores_mark_done',
    description: 'סימון מטלה כבוצעה ב-HomeChores (done=false מבטל). task: שם המטלה או id מ-chores_get.',
    input_schema: S({ task: { type: 'string' }, date: { type: 'string', description: 'YYYY-MM-DD, ברירת מחדל היום' }, done: { type: 'boolean' } }, ['task']),
  },
  {
    name: 'chores_add',
    description:
      'הוספת מטלה חדשה ל-HomeChores. repeatUnit: once/days/weeks/months. weekDays: 0=ראשון..6=שבת. ' +
      'taskType=weekly למטלה שבועית גמישה (פעם בשבוע בלי יום קבוע). assignees: שמות חברי הבית (ריק = כולם).',
    input_schema: S({
      title: { type: 'string' }, emoji: { type: 'string' }, area: { type: 'string' },
      repeatUnit: { type: 'string', enum: ['once', 'days', 'weeks', 'months'] }, repeatEvery: { type: 'number' },
      weekDays: { type: 'array', items: { type: 'number' } }, monthDay: { type: 'number' },
      taskType: { type: 'string', enum: ['daily', 'weekly'] }, timeOfDay: { type: 'string', enum: ['morning', 'evening', 'anytime'] },
      assignees: names, notes: { type: 'string' },
    }, ['title']),
  },
];

const RECIPES = [
  { name: 'recipes_search', description: 'חיפוש בספר המתכונים לפי שם, קטגוריה או מצרך. בלי query: כל המתכונים.', input_schema: S({ query: { type: 'string' } }) },
  { name: 'recipe_get', description: 'מתכון מלא מספר המתכונים: מצרכים, שלבים, הערות.', input_schema: S({ title: { type: 'string' } }, ['title']) },
  {
    name: 'recipe_add',
    description: 'הוספת מתכון חדש לספר המתכונים. ingredients: [{amt, name}], steps ו-notes: מערכי מחרוזות. רק כשהמשתמש מבקש לשמור מתכון.',
    input_schema: S({
      title: { type: 'string' }, category: { type: 'string' }, time: { type: 'string' }, yield: { type: 'string' },
      ingredients: { type: 'array', items: S({ amt: { type: 'string' }, name: { type: 'string' } }) },
      steps: names, notes: names,
    }, ['title', 'ingredients']),
  },
];

export function appTools(user) {
  return [
    ...(cart.enabled(user) ? CART : []),
    ...(chores.enabled(user) ? CHORES : []),
    ...(recipes.enabled(user) ? RECIPES : []),
  ];
}

export function connectedApps(user) {
  return [
    cart.enabled(user) && 'SmartCart (רשימת קניות משפחתית)',
    chores.enabled(user) && 'HomeChores (מטלות בית)',
    recipes.enabled(user) && 'ספר המתכונים',
  ].filter(Boolean);
}

export function runAppTool(user, name, input = {}) {
  switch (name) {
    case 'shopping_list_get': return cart.getList(user);
    case 'shopping_list_add': return cart.addItems(user, input.items);
    case 'shopping_list_remove': return cart.removeItems(user, input.names);
    case 'shopping_mark_bought': return cart.markBought(user, input.names, input.bought !== false);
    case 'shopping_clear_bought': return cart.clearBought(user);
    case 'chores_get': return chores.choresFor(user, input);
    case 'chores_mark_done': return chores.markDone(user, input);
    case 'chores_add': return chores.addChore(user, input);
    case 'recipes_search': return recipes.search(user, input.query);
    case 'recipe_get': return recipes.get(user, input.title);
    case 'recipe_add': return recipes.add(user, input);
    default: return undefined;
  }
}

export async function checkAll(user) {
  const out = {};
  const run = async (k, on, fn) => { if (!on) { out[k] = 'not configured'; return; } try { out[k] = await fn(user); } catch (e) { out[k] = { error: e.message }; } };
  await run('smartcart', cart.enabled(user), cart.check);
  await run('homechores', chores.enabled(user), chores.check);
  await run('recipes', recipes.enabled(user), recipes.check);
  return out;
}
