// Ported from the artifact: each rule's description is a fixed sentence with the
// tunable numbers embedded as inline <input> elements, right inside the text.
// `rule` is deliberately kept to one short sentence; `detail` (optional, for the
// more complex rules) carries secondary parameters and nuance in a muted subtitle.
const INSIGHT_RULES = [
  { type: 'churn', category: 'התראה', title: 'סיכון נטישה',
    rule: 'לקוח פעיל שלא רכש מעבר לזמן הרגיל שלו (לפחות {churn_dayFloor} יום, ולפחות פי {churn_gapMultiplier} מקצב הרכישה הרגיל שלו).',
    detail: 'נדרשות {churn_minPurchases}+ רכישות היסטוריות כדי לחשב את הקצב הרגיל. חומרה גבוהה כשחלף פי {churn_highMultiplier} מהסף.' },
  { type: 'decline', category: 'התראה', title: 'ירידת מחזור',
    rule: 'ירידה של {decline_pctThreshold}%+ במחזור הלקוח ב-{decline_currentWindowDays} הימים האחרונים, לעומת התקופה המקבילה אשתקד.',
    detail: 'נדרש מחזור בסיס של {decline_minBaseRevenue}₪. אם אין נתוני שנה קודמת, ההשוואה תהיה לתקופה קודמת בת {decline_priorWindowDays} ימים. חומרה גבוהה מעל {decline_highPct}%.' },
  { type: 'monthlyRevenueShift', category: 'התראה', title: 'מגמת מחזור חודשית — תובנה 1א',
    rule: 'שינוי של {monthly_pctThreshold}%+ במחזור הלקוח החודש מול החודש הקודם, לכל כיוון (עלייה או ירידה).',
    detail: 'נדרש מחזור בסיס של {monthly_minBaseRevenue}₪. מוצגים עד {monthly_topN} המוצרים שתרמו הכי הרבה לשינוי. חומרה גבוהה מעל {monthly_highPct}%.' },
  { type: 'quarterlyRevenueShift', category: 'התראה', title: 'מגמת מחזור רבעונית — תובנה 1ב',
    rule: 'שינוי של {quarterlyDecline_pctThreshold}%+ במחזור הרבעון האחרון, לעומת הרבעון הקודם או המקביל אשתקד, לכל כיוון.',
    detail: 'נדרש מחזור בסיס של {quarterlyDecline_minBaseRevenue}₪, בעדיפות להשוואה מול הרבעון המקביל אשתקד אם קיים. חומרה גבוהה מעל {quarterlyDecline_highPct}%.' },
  { type: 'cumulativeYoyShift', category: 'התראה', title: 'מגמת מחזור מצטברת שנתית — תובנה 1ג',
    rule: 'שינוי של {cumulativeYoy_pctThreshold}%+ במחזור המצטבר מתחילת השנה, לעומת אותה תקופה אשתקד, לכל כיוון.',
    detail: 'משלים את "ירידת מחזור" עם חלון רגיש יותר וממוקד-שנה. נדרש מחזור בסיס של {cumulativeYoy_minBaseRevenue}₪ אשתקד. חומרה גבוהה מעל {cumulativeYoy_highPct}%.' },
  { type: 'decliningTrend', category: 'התראה', title: 'מגמת קיטון',
    rule: 'מחזור לקוח שיורד ברציפות {decliningTrend_monthsRequired} חודשים ברצף, בכ-{decliningTrend_pctPerMonth}%+ בכל חודש.',
    detail: 'כל אחד מהחודשים הנבדקים חייב לכלול מכירה בפועל.' },
  { type: 'dropoff', category: 'התראה', title: 'הפסקת מוצר',
    rule: 'לקוח פעיל שהפסיק לרכוש מוצר שקנה בעבר {dropoff_minPurchases}+ פעמים, מעבר לזמן הרגיל שלו למוצר הזה.',
    detail: 'נבדק רק אם ללקוח יש פעילות כלשהי ב-{dropoff_recentActivityDays} הימים האחרונים. לא מוצג אם המוצר חסר במלאי. הסף: מקסימום בין {dropoff_dayFloor} יום לפי {dropoff_gapMultiplier} מקצב הרגיל. חומרה גבוהה מעל פי {dropoff_highGapMultiplier}.' },
  { type: 'varietyNarrowing', category: 'התראה', title: 'צמצום מגוון רכישות',
    rule: 'ירידה של {varietyNarrowing_pctThreshold}%+ במספר סוגי המוצרים שהלקוח קונה, ב-{varietyNarrowing_windowDays} הימים האחרונים לעומת התקופה הקודמת.',
    detail: 'נדרשים {varietyNarrowing_minPriorProducts}+ מוצרים שונים בתקופת הבסיס. חומרה גבוהה מעל {varietyNarrowing_highPct}%.' },
  { type: 'frequencyDecline', category: 'התראה', title: 'ירידת תדירות',
    rule: 'ירידה של {freq_pctThreshold}%+ בתדירות הרכישות של לקוח ב-{freq_windowDays} הימים האחרונים לעומת התקופה שלפניה.',
    detail: 'נדרשים {freq_minTotalDrops}+ רכישות נפרדות בסך הכול ו-{freq_minPrevDrops}+ בתקופת הבסיס. חומרה גבוהה מעל {freq_highPct}%.' },
  { type: 'monthlyProductBreak', category: 'התראה', title: 'שבירת דפוס חודשי',
    rule: 'לקוח שרכש מוצר בקביעות ({monthlyBreak_establishedMonthsNeeded}+ מתוך {monthlyBreak_totalMonthsChecked} החודשים האחרונים) ולא רכש אותו החודש.',
    detail: 'לא מוצג אם המוצר חסר במלאי. חומרה גבוהה מעל {monthlyBreak_highMonthsNeeded} חודשים.' },
  { type: 'anomaly', category: 'התראה', title: 'חריגה לא צפויה',
    rule: 'שינוי חד ({anomaly_pctThreshold}%+) בכמות המכירה החודשית של מוצר, לעומת הממוצע של {anomaly_minMonths} החודשים הקודמים.',
    detail: 'לא מוצג אם השינוי מוסבר על ידי חג/עונה שסומנו כרלוונטיים למוצר. חומרה גבוהה מעל {anomaly_highPct}%.' },
  { type: 'seasonalDecline', category: 'התראה', title: 'ירידה עונתית/חג — תובנה 1ד',
    rule: 'ירידה של {seasonal_pctThreshold}%+ ברכישת מוצר רלוונטי לחג/עונה, לעומת אותו אירוע אשתקד.',
    detail: 'ההשוואה היא לפי התאריכים המדויקים של החג/העונה השנה מול אשתקד (טבלת ניהול חגים), לא לפי לוח שנה קבוע. המוצר חייב להיות מסומן כרלוונטי לאירוע במסך שיוך חג ועונה למוצר, ונדרש מחזור בסיס של {seasonal_minBaseRevenue}₪. חומרה גבוהה מעל {seasonal_highPct}%.' },
  { type: 'holidayMomentumShift', category: 'התראה', title: 'מומנטום בין חגים — תובנה 1ד',
    rule: 'שינוי של {seasonal_pctThreshold}%+ ברכישת מוצר בין חג/עונה לבין החג/העונה האחרים שקדמו לו באותה שנה.',
    detail: 'משלים את ההשוואה לאשתקד בציר נוסף: האם הביצועים בחג הנוכחי ממשיכים את המומנטום מהאירוע האחרון שקדם לו (למשל פורים לעומת פסח), ולא רק מול אותו חג אשתקד. שני האירועים חייבים להיות מסומנים כרלוונטיים למוצר. נדרש מחזור בסיס של {seasonal_minBaseRevenue}₪. חומרה גבוהה מעל {seasonal_highPct}%.' },

  { type: 'lookalike', category: 'הזדמנות', title: 'פוטנציאל צמיחה',
    rule: 'לקוח שמחזורו נמוך מ-{lookalike_pctOfAvg}% מהממוצע בקבוצת הלקוחות הדומה לו (סיווג ראשי).',
    detail: 'נדרשים {lookalike_minGroupSize}+ לקוחות פעילים בקבוצה להשוואה. חומרה גבוהה מתחת ל-{lookalike_highPctOfAvg}%.' },
  { type: 'upsell', category: 'הזדמנות', title: 'הזדמנות Upsell',
    rule: 'מוצר שרוב הלקוחות הדומים ({upsell_popularityPct}%+ מאותו סיווג ראשי) רוכשים, אך הלקוח הזה לא.',
    detail: 'מוצג רק אם המוצר במלאי.' },
  { type: 'productVarietyGap', category: 'הזדמנות', title: 'פער מגוון מוצרים',
    rule: 'מוצר שרוב הלקוחות מאותו סוג לקוח ({variety_popularityPct}%+) רוכשים, אך הלקוח הזה לא.',
    detail: 'נדרשים {variety_minGroupSize}+ לקוחות פעילים מאותו סוג להשוואה. מוצג רק אם המוצר במלאי.' },
  { type: 'hierarchyUpsell', category: 'הזדמנות', title: 'הזדמנות ממחלקת מוצר',
    rule: 'מוצר ממחלקה מסוימת שרוב הלקוחות הקונים מאותה מחלקה רוכשים ({hierarchyUpsell_popularityPct}%+), אך הלקוח הזה לא.',
    detail: 'הקבוצה נקבעת לפי התנהגות קנייה בפועל (איזו מחלקת מוצרים הלקוח קונה ממנה בכלל), לא לפי שיוך מוצהר. נדרשים {hierarchyUpsell_minGroupSize}+ לקוחות בקבוצה, והמוצר חייב להיות במלאי.' },
  { type: 'centralCustomerCrossSell', category: 'הזדמנות', title: 'הזדמנות בין-סניפית',
    rule: 'מוצר שרוב הסניפים תחת אותו "לקוח מרכז" רוכשים ({centralCross_popularityPct}%+), אך הסניף הזה לא.',
    detail: 'נדרשים {centralCross_minGroupSize}+ סניפים תחת אותו לקוח מרכז, והמוצר חייב להיות במלאי.' },
  { type: 'substituteOpportunity', category: 'הזדמנות', title: 'הצעת מוצר תחליפי',
    rule: 'מוצר חסר במלאי שיש לו תחליף פעיל במלאי — מוצע ללקוחות שקנו אותו ב-{substOpp_lookbackDays} הימים האחרונים.',
    detail: 'לפי טבלת "מוצרים תחליפיים". רלוונטי רק אם גם המוצר התחליפי במלאי.' },
  { type: 'standingOrderOpportunity', category: 'הזדמנות', title: 'הצעת הזמנה שוטפת',
    rule: 'לקוח שרוכש כמעט כל חודש ({standingOrder_minMonthsActive}+ מתוך {standingOrder_windowMonths} החודשים האחרונים) וטרם רכש החודש.',
    detail: 'נבדק רק החל מיום {standingOrder_dayOfMonthGate} בחודש, כדי לא להתריע מוקדם מדי בחודש.' },
  { type: 'marketingUnderperformance', category: 'הזדמנות', title: 'מוצר משווק שלא נמכר',
    rule: 'מוצר המסומן ל"שיווק" שנמכר {marketingUnderperf_maxUnits} יחידות או פחות ב-{marketingUnderperf_lookbackMonths} החודשים האחרונים.',
    detail: 'תובנה ברמת המוצר, לא לקוח ספציפי. לא מוצגת אם המוצר חסר במלאי (זו אז בעיית היצע, לא שיווק).' },
  { type: 'upcomingEventReminder', category: 'הזדמנות', title: 'תזכורת לקראת אירוע',
    rule: 'חג/עונה מתקרבים (עד {upcomingEvent_daysAhead} ימים), ולקוח שקנה מוצר רלוונטי באירוע המקביל אשתקד עדיין לא הזמין השנה.',
    detail: 'המוצר חייב להיות מסומן כרלוונטי לאירוע במסך שיוך חג ועונה למוצר.' },
  { type: 'seasonalGrowth', category: 'הזדמנות', title: 'צמיחה עונתית/חג — תובנה 1ד',
    rule: 'עלייה של {seasonal_pctThreshold}%+ ברכישת מוצר רלוונטי לחג/עונה, לעומת אותו אירוע אשתקד.',
    detail: 'ההשוואה היא לפי התאריכים המדויקים של החג/העונה השנה מול אשתקד (טבלת ניהול חגים), לא לפי לוח שנה קבוע. המוצר חייב להיות מסומן כרלוונטי לאירוע במסך שיוך חג ועונה למוצר, ונדרש מחזור בסיס של {seasonal_minBaseRevenue}₪. חומרה גבוהה מעל {seasonal_highPct}%.' },

  { type: 'productQuantityShift', category: 'התראה', title: 'שינוי בכמות מוצר — תובנה 2א',
    rule: 'שינוי של {productQty_pctThreshold}%+ בכמות שהלקוח קונה ממוצר מסוים, ב-{productQty_windowDays} הימים האחרונים לעומת התקופה הקודמת.',
    detail: 'נדרשת כמות בסיס של {productQty_minPriorQty}+ יחידות בתקופה הקודמת. מוצר עם תחליף מוגדר נספר יחד עם התחליף שלו כיחידה אחת. חומרה גבוהה מעל {productQty_highPct}%.' },
  { type: 'productFrequencyYoyShift', category: 'התראה', title: 'שינוי בתדירות מוצר — תובנה 2ה',
    rule: 'שינוי של {productFreqYoy_pctThreshold}%+ במספר החודשים שבהם הלקוח קונה מוצר מסוים, השנה לעומת אשתקד.',
    detail: 'נדרשים {productFreqYoy_minPriorMonths}+ חודשים עם רכישה אשתקד להשוואה. מוצר עם תחליף מוגדר נספר יחד עם התחליף שלו. חומרה גבוהה מעל {productFreqYoy_highPct}%.' },
  { type: 'productConcentrationRisk', category: 'התראה', title: 'סיכון ריכוזיות מוצרים',
    rule: '{concentration_pctThreshold}%+ ממחזור הלקוח מגיעים מ-{concentration_topN} מוצרים בלבד.',
    detail: 'נדרש מחזור לקוח כולל של {concentration_minRevenue}₪ לפחות. חומרה גבוהה מעל 85% ריכוזיות.' },
  { type: 'purchaseIrregularity', category: 'הזדמנות', title: 'קצב רכישה לא סדיר — תובנה 2ג',
    rule: 'מוצר שמהווה {irregularity_minRevenueShare}%+ ממחזור הלקוח, אך נרכש במרווחי זמן לא עקביים (מקדם שונות מעל {irregularity_cvThreshold}%).',
    detail: 'נדרשות {irregularity_minPurchases}+ רכישות היסטוריות למוצר כדי לחשב את סדירות הרכישה. הזדמנות להציע ללקוח לעבור להזמנה קבועה של המוצר.' },
  { type: 'newProductAdopted', category: 'הזדמנות', title: 'אימוץ מוצר חדש',
    rule: 'לקוח שהתחיל לרכוש מוצר שמעולם לא קנה קודם, ב-{newProduct_lookbackDays} הימים האחרונים.',
    detail: 'נדרש מחזור של {newProduct_minRevenue}₪ לפחות מהמוצר החדש כדי לוודא שמדובר באימוץ אמיתי ולא רכישת ניסיון בודדת.' }
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
    let lastCategory = null;
    INSIGHT_RULES.forEach((r) => {
      if (r.category !== lastCategory) {
        html += '<div class="rules-category-heading">' + Layout.escapeHtml(r.category === 'התראה' ? 'התראות' : 'הזדמנויות') + '</div>';
        lastCategory = r.category;
      }
      html += '<div class="rule-card"><div class="rule-title">' + Layout.escapeHtml(r.title) + '</div>' +
        '<div class="rule-text">' + renderRuleTemplate(r.rule) + '</div>' +
        (r.detail ? '<div class="rule-detail">' + renderRuleTemplate(r.detail) + '</div>' : '') +
        '</div>';
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
