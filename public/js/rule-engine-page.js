// Ported from the artifact: each sub-check's description is a fixed sentence with the
// tunable numbers embedded as inline <input> elements, right inside the text.
// The engine only ever produces 2 insight types — one card per rule — so every
// sub-check that used to be its own separate rule card is now grouped inside the
// one card for the rule it belongs to (Rule 1: customer sales pattern, Rule 2:
// customer purchase pattern).
const INSIGHT_RULES = [
  { type: 'salesPattern', title: 'זיהוי דפוס מכירות לקוח — תובנה 1',
    subrules: [
      { title: 'מגמה חודשית',
        rule: 'שינוי של {monthly_pctThreshold}%+ במחזור הלקוח החודש מול החודש הקודם, לכל כיוון (עלייה או ירידה).',
        detail: 'נדרש מחזור בסיס של {monthly_minBaseRevenue}₪. מוצגים עד {monthly_topN} המוצרים שתרמו הכי הרבה לשינוי. חומרה גבוהה מעל {monthly_highPct}%.' },
      { title: 'מגמה רבעונית',
        rule: 'שינוי של {quarterlyDecline_pctThreshold}%+ במחזור הרבעון האחרון, לעומת הרבעון הקודם או המקביל אשתקד, לכל כיוון.',
        detail: 'נדרש מחזור בסיס של {quarterlyDecline_minBaseRevenue}₪, בעדיפות להשוואה מול הרבעון המקביל אשתקד אם קיים. חומרה גבוהה מעל {quarterlyDecline_highPct}%.' },
      { title: 'מגמה מצטברת שנתית',
        rule: 'שינוי של {cumulativeYoy_pctThreshold}%+ במחזור המצטבר מתחילת השנה, לעומת אותה תקופה אשתקד, לכל כיוון.',
        detail: 'משלים את המגמה החודשית עם חלון רגיש יותר וממוקד-שנה. נדרש מחזור בסיס של {cumulativeYoy_minBaseRevenue}₪ אשתקד. חומרה גבוהה מעל {cumulativeYoy_highPct}%.' },
      { title: 'עלייה/ירידה עונתית או סביב חג',
        rule: 'שינוי של {seasonal_pctThreshold}%+ ברכישת מוצר רלוונטי לחג/עונה, לעומת אותו אירוע אשתקד, לכל כיוון.',
        detail: 'ההשוואה היא לפי התאריכים המדויקים של החג/העונה השנה מול אשתקד (טבלת ניהול חגים), לא לפי לוח שנה קבוע. המוצר חייב להיות מסומן כרלוונטי לאירוע במסך שיוך חג ועונה למוצר, ונדרש מחזור בסיס של {seasonal_minBaseRevenue}₪. חומרה גבוהה מעל {seasonal_highPct}%.' },
      { title: 'מומנטום בין חגים',
        rule: 'שינוי של {seasonal_pctThreshold}%+ ברכישת מוצר בין חג/עונה לבין החג/העונה האחרים שקדמו לו באותה שנה.',
        detail: 'משלים את ההשוואה לאשתקד בציר נוסף: האם הביצועים בחג הנוכחי ממשיכים את המומנטום מהאירוע האחרון שקדם לו (למשל פורים לעומת פסח). שני האירועים חייבים להיות מסומנים כרלוונטיים למוצר. נדרש מחזור בסיס של {seasonal_minBaseRevenue}₪. חומרה גבוהה מעל {seasonal_highPct}%.' }
    ] },
  { type: 'purchasePattern', title: 'דפוס רכישה של לקוח — תובנה 2',
    subrules: [
      { title: 'שינוי בכמות מוצר',
        rule: 'שינוי של {productQty_pctThreshold}%+ בכמות שהלקוח קונה ממוצר מסוים, ב-{productQty_windowDays} הימים האחרונים לעומת התקופה הקודמת.',
        detail: 'נדרשת כמות בסיס של {productQty_minPriorQty}+ יחידות בתקופה הקודמת. מוצר עם תחליף מוגדר נספר יחד עם התחליף שלו כיחידה אחת. חומרה גבוהה מעל {productQty_highPct}%.' },
      { title: 'שינוי בתדירות מוצר',
        rule: 'שינוי של {productFreqYoy_pctThreshold}%+ במספר החודשים שבהם הלקוח קונה מוצר מסוים, השנה לעומת אשתקד.',
        detail: 'נדרשים {productFreqYoy_minPriorMonths}+ חודשים עם רכישה אשתקד להשוואה. מוצר עם תחליף מוגדר נספר יחד עם התחליף שלו. חומרה גבוהה מעל {productFreqYoy_highPct}%.' },
      { title: 'סיכון ריכוזיות מוצרים',
        rule: '{concentration_pctThreshold}%+ ממחזור הלקוח מגיעים מ-{concentration_topN} מוצרים בלבד.',
        detail: 'נדרש מחזור לקוח כולל של {concentration_minRevenue}₪ לפחות. חומרה גבוהה מעל 85% ריכוזיות.' },
      { title: 'קצב רכישה לא סדיר',
        rule: 'מוצר שמהווה {irregularity_minRevenueShare}%+ ממחזור הלקוח, אך נרכש במרווחי זמן לא עקביים (מקדם שונות מעל {irregularity_cvThreshold}%).',
        detail: 'נדרשות {irregularity_minPurchases}+ רכישות היסטוריות למוצר כדי לחשב את סדירות הרכישה. הזדמנות להציע ללקוח לעבור להזמנה קבועה של המוצר.' },
      { title: 'אימוץ מוצר חדש',
        rule: 'לקוח שהתחיל לרכוש מוצר שמעולם לא קנה קודם, ב-{newProduct_lookbackDays} הימים האחרונים.',
        detail: 'נדרש מחזור של {newProduct_minRevenue}₪ לפחות מהמוצר החדש כדי לוודא שמדובר באימוץ אמיתי ולא רכישת ניסיון בודדת.' }
    ] }
];

async function initRuleEnginePage() {
  const data = await Layout.init('rule-engine');
  if (!data) return;

  const res = await fetch('/api/rule-settings', { credentials: 'include' });
  const payload = await res.json();
  let values = payload.values;
  const defaults = payload.defaults;

  function renderRuleTemplate(template) {
    return template.replace(/\{([a-zA-Z_]+)\}/g, (m, paramId) => {
      const val = values[paramId] != null ? values[paramId] : defaults[paramId];
      const isInt = defaults[paramId] % 1 === 0;
      return '<input type="number" class="rule-param-input js-ruleParamInput" data-param="' + paramId + '" value="' + val + '"' + (isInt ? ' step="1"' : ' step="0.1"') + '>';
    });
  }

  function render() {
    const container = document.getElementById('rulesContainer');
    let html = '';
    INSIGHT_RULES.forEach((r) => {
      html += '<div class="rule-card"><div class="rule-title">' + Layout.escapeHtml(r.title) + '</div>';
      r.subrules.forEach((sub) => {
        html += '<div class="rule-subblock" style="margin-top:10px;">' +
          '<div class="rule-subtitle" style="font-weight:600;">' + Layout.escapeHtml(sub.title) + '</div>' +
          '<div class="rule-text">' + renderRuleTemplate(sub.rule) + '</div>' +
          (sub.detail ? '<div class="rule-detail">' + renderRuleTemplate(sub.detail) + '</div>' : '') +
          '</div>';
      });
      html += '</div>';
    });
    container.innerHTML = html;

    container.querySelectorAll('.js-ruleParamInput').forEach((input) => {
      input.addEventListener('change', async () => {
        const paramId = input.getAttribute('data-param');
        const value = Number(input.value);
        if (isNaN(value)) return;
        values[paramId] = value;
        await fetch('/api/rule-settings/' + paramId, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ value }) });
      });
    });
  }

  document.getElementById('resetAllBtn').addEventListener('click', async () => {
    await fetch('/api/rule-settings', { method: 'DELETE', credentials: 'include' });
    values = Object.assign({}, defaults);
    render();
  });

  render();
}
