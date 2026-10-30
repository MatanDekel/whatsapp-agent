# סוכן אישי: וואטסאפ + אייפון

סוכן מבוסס Claude שרץ על Vercel. אפשר לכתוב לו בוואטסאפ או להפעיל אותו מ-Siri. הוא מכיר את הלו"ז שלך מהיומן באייפון, שולח תזכורות בוואטסאפ בזמן שביקשת ולפני כל אירוע, יוצר תזכורות ואירועים באייפון, ושולח סיכום בוקר.

דוגמאות: "תזכיר לי מחר ב-10 להתקשר לרופא", "מה יש לי ביום חמישי?", "תזכיר לי שעה לפני הפגישה עם דנה לקנות מתנה".

```
וואטסאפ ──► /api/whatsapp ──┐
                            ├──► Claude + כלים ──► Redis (זיכרון, משימות, תור פעולות)
Siri/Shortcut ► /api/shortcut┘                          │
                                                        ▼
Cron 08:00 ► /api/cron/daily ──► סיכום בוואטסאפ    Shortcut מבצע תזכורות/יומן באייפון
יומן האייפון ► Shortcut ► /api/calendar ──► Redis
QStash (בזמן התזכורת) ► /api/reminder-fire ──► תזכורת בוואטסאפ
```

## 1. פריסה ל-Vercel
1. מעלים לריפו ב-GitHub ומייבאים ב-Vercel.
2. ב-Vercel → Storage / Marketplace → מחברים **Upstash Redis** ו-**Upstash QStash** (המשתנים נוצרים לבד).
   QStash הוא שירות התזמון: הוא קורא לשרת בדיוק בזמן של כל תזכורת.
3. מוסיפים את שאר המשתנים מ-`.env.example`.
4. `SHORTCUT_TOKEN` ו-`CRON_SECRET`: יוצרים עם `openssl rand -hex 32`. `APP_URL`: כתובת ה-production.
5. אם Deployment Protection פעיל, וודאי שהוא לא חוסם את כתובת ה-production, אחרת QStash ו-Meta לא יגיעו לשרת.

## 2. WhatsApp Cloud API
1. developers.facebook.com → Create App → סוג **Business** → מוסיפים את המוצר **WhatsApp**.
2. מוסיפים מספר טלפון לבוט (מספר שלא רשום בוואטסאפ רגיל, אפשר eSIM או מספר וירטואלי).
3. Business Settings → System Users → יוצרים System User, מקצים לו את האפליקציה ומפיקים **טוקן קבוע** עם `whatsapp_business_messaging`, `whatsapp_business_management` ← `WA_TOKEN`.
4. מעתיקים את **Phone number ID** ← `WA_PHONE_NUMBER_ID`, ואת App Settings → Basic → **App Secret** ← `WA_APP_SECRET`.
5. WhatsApp → Configuration → Webhook:
   - Callback URL: `https://<הפרויקט>.vercel.app/api/whatsapp`
   - Verify token: מה ששמת ב-`WA_VERIFY_TOKEN`
   - Subscribe לשדה **messages**.
6. `OWNER_NUMBER`: המספר שלך בפורמט בינלאומי בלי `+`, למשל `972501234567`. הבוט מתעלם מכל מספר אחר.

### תבנית להודעות יזומות (תזכורות וסיכום בוקר)
וואטסאפ מאפשר לבוט לשלוח טקסט חופשי רק בתוך 24 שעות מההודעה האחרונה שלך. מחוץ לחלון הזה צריך תבנית מאושרת, אחרת תזכורות לא יגיעו.
WhatsApp Manager → Message templates → Create:
- שם: `agent_update`, קטגוריה **Utility**, שפה: עברית
- גוף: `עדכון מהסוכן שלך: {{1}}`

הקוד בוחר לבד בין טקסט חופשי לתבנית.

## 3. Shortcuts באייפון

### קיצור "שאל את הסוכן" (להפעלה מ-Siri)
1. **Dictate Text** (או Ask for Input).
2. **Get Contents of URL**
   - URL: `https://<הפרויקט>.vercel.app/api/shortcut`
   - Method: POST
   - Headers: `Authorization` = `Bearer <SHORTCUT_TOKEN>`
   - Request Body: JSON, מפתח `text` = Dictated Text
3. **Get Dictionary Value** `actions` → **Repeat with Each**:
   - Get Dictionary Value `type` מתוך Repeat Item
   - **If** type = `reminder` → Get Dates from (`date`) → **Add New Reminder** (כותרת `title`, התראה בתאריך)
   - **If** type = `calendar` → **Add New Event** (`title`, התחלה `date`, סיום `end_date`, `location`)
   - **If** type = `open_url` → **Open URLs** (`url`)
4. מחוץ ללולאה: Get Dictionary Value `reply` → **Speak Text** או **Show Result**.

אפשר להוסיף ל-Siri, למסך הבית או לכפתור ה-Action.

### קיצור "סנכרון סוכן"
אותו קיצור בלי שלב 1 ועם גוף JSON ריק (`{}`). הוא מבצע פעולות שביקשת דרך וואטסאפ.
Automation → Personal → למשל **When WhatsApp is closed** או כמה שעות קבועות ביום → Run Immediately.

### קיצור "סנכרון יומן" (כדי שהסוכן יכיר את הלו"ז)
1. **Find Calendar Events** where **Start Date** is in the next **7** days (בלי סינון יומן, כך שנכללים גם Google ו-Outlook שמחוברים לאייפון).
2. **Repeat with Each** אירוע:
   - **Format Date** של Start Date → פורמט **ISO 8601** (כולל שעה). אותו דבר ל-End Date.
   - **Dictionary**: `title` = Title, `start` = התאריך המעוצב, `end` = סיום מעוצב, `location` = Location, `allDay` = Is All Day
   - **Add to Variable** `Events`
3. **Get Contents of URL**: `https://<הפרויקט>.vercel.app/api/calendar`, POST, אותו Header `Authorization`, JSON עם מפתח `events` (סוג Array) = משתנה Events.

אוטומציות: **Time of Day** ב-06:30 כל יום (לפני סיכום הבוקר), וגם **When Calendar is closed**, כדי שאירועים חדשים ייכנסו מיד. בשתיהן: Run Immediately.

## תזכורות
- "תזכיר לי..." נשלח כהודעת וואטסאפ בזמן שנקבע. "מה התזכורות שלי?" ו"תבטל את..." עובדים גם.
- לפני כל אירוע ביומן נשלחת תזכורת אוטומטית (`EVENT_REMINDER_MINUTES`, ברירת מחדל 30). אם אירוע זז או נמחק, התזכורת הישנה לא נשלחת.
- תזכורות שרחוקות יותר משבוע נשמרות ומתוזמנות לבד על ידי ה-cron היומי.

## פקודות
- `/reset` בוואטסאפ: מוחק את היסטוריית השיחה (פתקים ומשימות נשמרים).

## הערות
- Cron רץ ב-05:00 UTC, שזה 07:00 או 08:00 בישראל. משנים ב-`vercel.json`.
- כדי להוריד עלויות אפשר לשים `MODEL=claude-haiku-5-5`.
- תזכורות חוזרות ("כל יום ראשון") עוד לא נתמכות, וזו הרחבה טבעית.
- הבוט מטפל כרגע רק בטקסט. הודעות קוליות ותמונות הן הרחבה הגיונית לשלב הבא.
