// Ported from the artifact: each rule's description is a fixed sentence with the
// tunable numbers embedded as inline <input> elements, right inside the text.
const INSIGHT_RULES = [
  { type: 'churn', title: 'סיכון נטישה', rule: 'לקוח פעיל עם {churn_minPurchases}+ רכישות היסטוריות שלא רכש מעל הסף: המקסימום בין {churn_dayFloor} יום לבין פי {churn_gapMultiplier} מקצב הרכישה הרגיל שלו (חציון המרווחים בין רכישות עבר). חומרה גבוהה כשחלף פי {churn_highMultiplier} מהסף.' },
  { type: 'decline', title: 'ירידת מחזור', rule: 'ירידה של {decline_pctThreshold}%+ במחזור ב-{decline_currentWindowDays} הימים האחרונים, בהשוואה לתקופה המקבילה אשתקד (אם קיימת) או לתקופה קודמת בת {decline_priorWindowDays} ימים נוספים אם אין נתוני שנה קודמת. נדרש מחזור בסיס של לפחות {decline_minBaseRevenue}₪. חומרה גבוהה מעל {decline_highPct}%.' },
  { type: 'dropoff', title: 'הפסקת מוצר', rule: 'לקוח פעיל עם פעילות כלשהי ב-{dropoff_recentActivityDays} הימים האחרונים, שרכש מוצר מסוים {dropoff_minPurchases}+ פעמים בעבר אך לא רכש אותו מעבר לסף: המקסימום בין {dropoff_dayFloor} יום לפי {dropoff_gapMultiplier} מקצב הרכישה הרגיל שלו למוצר זה. חומרה גבוהה מעל פי {dropoff_highGapMultiplier}.' },
  { type: 'lookalike', title: 'פוטנציאל צמיחה', rule: 'לקוח פעיל שמחזורו נמוך מ-{lookalike_pctOfAvg}% מהמחזור הממוצע בקבוצת "סיווג ראשי לקוח" שלו (נדרשים {lookalike_minGroupSize}+ לקוחות פעילים בקבוצה להשוואה). חומרה גבוהה מתחת ל-{lookalike_highPctOfAvg}%.' },
  { type: 'upsell', title: 'הזדמנות Upsell', rule: 'מוצר (פעיל) שרוב הלקוחות ({upsell_popularityPct}%+) מאותה קבוצת "סיווג ראשי לקוח" רוכשים, אך הלקוח הנוכחי לא רוכש כלל.' },
  { type: 'anomaly', title: 'חריגה לא צפויה', rule: 'שינוי של {anomaly_pctThreshold}%+ בכמות המכירה החודשית של מוצר (פעיל) לעומת ממוצע {anomaly_minMonths} החודשים הקודמים לו — אלא אם החודש חופף לחג/עונה שסומנו כרלוונטיים לאותו מוצר במסך השיוך, ואז החריגה נחשבת צפויה ולא מדווחת. חומרה גבוהה מעל {anomaly_highPct}%.' },
  { type: 'frequencyDecline', title: 'ירידת תדירות', rule: 'ירידה של {freq_pctThreshold}%+ במספר ה"דרופים" (תאריכי רכישה נפרדים וייחודיים, ללא קשר לכמות המוצרים בכל רכישה) ב-{freq_windowDays} הימים האחרונים לעומת {freq_windowDays} הימים שלפניהם (נדרשים {freq_minPrevDrops}+ דרופים בתקופת הבסיס, ו-{freq_minTotalDrops}+ בסך הכול). חומרה גבוהה מעל {freq_highPct}%.' },
  { type: 'monthlyProductBreak', title: 'שבירת דפוס חודשי', rule: 'לקוח פעיל שרכש מוצר (פעיל) ב-{monthlyBreak_establishedMonthsNeeded}+ מתוך {monthlyBreak_totalMonthsChecked} החודשים האחרונים, ולא רכש אותו החודש הנוכחי — אלא אם למוצר מוגדר מלאי 0 בטבלת המלאי, ואז התובנה מדוכאת (אין מה למכור). חומרה גבוהה מעל {monthlyBreak_highMonthsNeeded} חודשים.' },
  { type: 'productVarietyGap', title: 'פער מגוון מוצרים', rule: 'מוצר (פעיל) שרוב הלקוחות ({variety_popularityPct}%+) מאותו "סוג לקוח" רוכשים, אך הלקוח הנוכחי לא (נדרשים {variety_minGroupSize}+ לקוחות פעילים מאותו סוג להשוואה).' },
  { type: 'monthlyDeclineDetail', title: 'ירידה חודשית מפורטת', rule: 'ירידה של {monthly_pctThreshold}%+ במחזור החודש הקלנדרי הנוכחי מול החודש הקלנדרי הקודם (מחזור בסיס מינימלי {monthly_minBaseRevenue}₪), עם זיהוי עד {monthly_topN} מוצרים (פעילים בלבד) שתרמו הכי הרבה לירידה, כולל הסכום בשקלים לכל אחד. חומרה גבוהה מעל {monthly_highPct}%.' },
  { type: 'seasonalGrowth', title: 'צמיחה עונתית/חגית', rule: 'לקוח שקנה מוצר (פעיל) המסומן כרלוונטי לחג/עונה מסוימים, ועלה ב-{seasonal_pctThreshold}%+ ברכישתו בתקופת האירוע האחרונה לעומת התקופה המקבילה באירוע הקודם (שנה קודמת) — נדרש מחזור בסיס של {seasonal_minBaseRevenue}₪ ולפחות 2 מופעים של אותו חג/עונה בנתונים. חומרה גבוהה מעל {seasonal_highPct}%.' },
  { type: 'seasonalDecline', title: 'ירידה עונתית/חגית', rule: 'אותו חישוב בדיוק כמו "צמיחה עונתית/חגית", בכיוון ההפוך: ירידה של {seasonal_pctThreshold}%+ ברכישת מוצר רלוונטי בין שני המופעים האחרונים של אותו חג/עונה. חומרה גבוהה מעל {seasonal_highPct}%.' }
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
      html += '<div class="rule-card"><div class="rule-title">' + Layout.escapeHtml(r.title) + '</div><div class="rule-text">' + renderRuleTemplate(r.rule) + '</div></div>';
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
