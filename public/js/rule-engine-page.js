// Ported from the artifact: each sub-check's description is a fixed sentence with the
// tunable numbers embedded as inline <input> elements, right inside the text.
// The engine produces 3 insight types — one card per rule — so every sub-check that
// used to be its own separate rule card is now grouped inside the one card for the
// rule it belongs to (Rule 1: customer sales pattern, Rule 2: customer purchase
// pattern, Rule 3: purchase gap vs. peer customers).
const INSIGHT_RULES = [
  { type: 'salesPattern', title: 'זיהוי דפוס מכירות לקוח — תובנה 1',
    subrules: [
      { title: 'מגמה חודשית',
        rule: 'ירידה של {monthly_pctThreshold}%+ במחזור הלקוח בחודש הקלנדרי האחרון שהסתיים במלואו, מול החודש שלפניו.',
        detail: 'נדרש מחזור בסיס של {monthly_minBaseRevenue}₪. מוצג המוצר שתרם הכי הרבה לירידה. חומרה גבוהה מעל {monthly_highPct}%. החודש הנוכחי (אם עדיין באמצעו) אינו נכלל בהשוואה — כך שאין ירידה מדומה רק בגלל שהחודש טרם הסתיים. ירידה שמוסברת ע"י חג/עונה קרובים כן מופקת כתובנה, בכל רמת חומרה, עם ציון מפורש ותגית "לבדיקה נוספת" (ראו הגדרה כללית 8), ועלייה במחזור אינה מופקת כתובנה (ראו הגדרה כללית 7).' },
      { title: 'מגמה רבעונית',
        rule: 'ירידה של {quarterlyDecline_pctThreshold}%+ במחזור הרבעון האחרון, לעומת הרבעון הקודם או המקביל אשתקד.',
        detail: 'נדרש מחזור בסיס של {quarterlyDecline_minBaseRevenue}₪, בעדיפות להשוואה מול הרבעון המקביל אשתקד אם קיים. חומרה גבוהה מעל {quarterlyDecline_highPct}%.' },
      { title: 'מגמת ירידה עקבית — מדרגה חדה',
        rule: 'מחזור הלקוח ב-{trend_windowMonths} החודשים הקלנדריים האחרונים שהסתיימו במלואם נמצא במגמת ירידה: ממוצע המחצית השנייה של התקופה נמוך ב-{trend_pctThreshold}%+ מממוצע המחצית הראשונה, ללא חזרה לרמה הקודמת.', detail: 'נדרש מחזור בסיס ממוצע של {trend_minBaseRevenue}₪ במחצית הראשונה. מותרת עלייה חד-פעמית אחת בין שני חודשים סמוכים (מעל {trend_recoveryTolerancePct}%) מבלי לפסול את המגמה — יותר מכך נחשב תנודתיות ולא מגמה. חומרה גבוהה מעל {trend_highPct}%. אם אותו לקוח מקיים גם את כלל המגמה המצטברת השנתית, מופקת תובנה אחת משולבת ולא שתיים. ירידה שמוסברת ע"י חג/עונה קרובים כן מופקת כתובנה, בכל רמת חומרה, עם ציון מפורש ותגית "לבדיקה נוספת" — רק כאשר {trend_windowMonths} החודשים הם 2 לכל היותר (ראו הגדרה כללית 8).' },
      { title: 'מגמת ירידה עקבית — ירידה משיא ואי-חזרה אליו',
        rule: 'ב-{peakDrop_windowMonths} החודשים הקלנדריים האחרונים שהסתיימו במלואם: נמצא חודש השיא במחצית הראשונה של התקופה, וממוצע המחצית השנייה נמוך ממנו ב-{peakDrop_pctThreshold}%+.', detail: 'תופס לקוח שהיה במגמת עלייה או הציג חודש חזק ואז נחלש בחדות — ולא חזר לרמה ההיא באף אחד מהחודשים שלאחר מכן. שונה מהבדיקה החדה: תופס גם כשהירידה עצמה קרתה מוקדם בתוך התקופה ומאז הרמה החדשה, הנמוכה יותר, נראית "יציבה" מול עצמה. נדרש שחודש השיא יהיה בעל מחזור של {peakDrop_minBaseRevenue}₪ לפחות. חומרה גבוהה מעל {peakDrop_highPct}%. אם אותו לקוח מקיים גם את כלל המגמה המצטברת השנתית, מופקת תובנה אחת משולבת.' },
      { title: 'מגמת ירידה עקבית — שחיקה הדרגתית',
        rule: 'מחזור הלקוח ב-{trend_slowWindowMonths} החודשים הקלנדריים האחרונים שהסתיימו במלואם נשחק בהדרגה: החודש האחרון נמוך מהחודש הראשון בתקופה, ולכל היותר {trend_slowMaxUpSteps} מהמעברים החודשיים בתוכה הם עלייה.', detail: 'משלים את מגמת הירידה החדה עבור לקוח שיורד לאט אך כמעט ברציפות — כל צעד חודשי קטן מדי כדי לחצות את הסף של הבדיקה החדה בתוך חלון קצר, אך הכיוון ברור לאורך תקופה ארוכה יותר. אותם תנאי בסיס וחומרה כמו בבדיקה החדה. אם שתיים או יותר מבדיקות מגמת הירידה מתקיימות לאותו לקוח, מופקת תובנה אחת בלבד — בסדר עדיפות: מדרגה חדה, ירידה משיא, שחיקה הדרגתית. אם אותו לקוח מקיים גם את כלל המגמה המצטברת השנתית, מופקת תובנה אחת משולבת. ירידה שמוסברת ע"י חג/עונה קרובים אינה מופקת כתובנה (ראו הגדרה כללית 8).' },
      { title: 'מגמה מצטברת שנתית',
        rule: 'ירידה של {cumulativeYoy_pctThreshold}%+ במחזור המצטבר מתחילת השנה, לעומת אותה תקופה אשתקד.',
        detail: 'משלים את המגמה החודשית עם חלון רגיש יותר וממוקד-שנה. נדרש מחזור בסיס של {cumulativeYoy_minBaseRevenue}₪ אשתקד. התובנה מפרקת את הירידה המצטברת לפי חודשים ומציינת את החודש (או שני החודשים, אם שניהם תרמו משמעותית) שתרמו לה הכי הרבה. אם אותו לקוח מקיים גם את כלל מגמת הירידה העקבית, מופקת תובנה אחת משולבת. חומרה גבוהה מעל {cumulativeYoy_highPct}%.' }
    ] },
  { type: 'purchasePattern', title: 'דפוס רכישה של לקוח — תובנה 2',
    subrules: [
      { title: 'ירידה בכמות מוצר',
        rule: 'ירידה של {productQty_pctThreshold}%+ בכמות שהלקוח קונה ממוצר מסוים, ב-{productQty_windowMonths} החודשים הקלנדריים האחרונים שהסתיימו במלואם, לעומת {productQty_windowMonths} החודשים שלפניהם.',
        detail: 'נדרשת כמות בסיס של {productQty_minPriorQty}+ יחידות בתקופה הקודמת. מוצר עם תחליף מוגדר נספר יחד עם התחליף שלו כיחידה אחת. החודש הנוכחי (אם עדיין באמצעו) אינו נכלל בחלון. ירידה שמוסברת ע"י חג/עונה קרובים כן מופקת כתובנה, בכל רמת חומרה, עם ציון מפורש ותגית "לבדיקה נוספת" — רק כאשר {productQty_windowMonths} החודשים הם 2 לכל היותר (ראו הגדרה כללית 8). חומרה גבוהה מעל {productQty_highPct}%.' },
      { title: 'צמצום מגוון מוצרים',
        rule: 'ירידה של {variety_pctThreshold}%+ במספר המוצרים השונים שהלקוח קונה, ב-{variety_windowMonths} החודשים הקלנדריים האחרונים שהסתיימו במלואם, לעומת {variety_windowMonths} החודשים שלפניהם.',
        detail: 'נדרשים {variety_minPriorCount}+ מוצרים שונים בתקופה הקודמת כדי שיהיה ממה להצטמצם. מוצר עם תחליף מוגדר נספר יחד עם התחליף שלו כיחידה אחת. התובנה מפרטת אילו מוצרים הלקוח הפסיק לקנות. בשונה מ"ירידה בכמות מוצר", כלל זה תופס לקוח שממשיך לקנות באותה כמות ממה שנשאר, אך מהיצע מוצרים מצטמצם. חומרה גבוהה מעל {variety_highPct}%.' },
      { title: 'ירידה בתדירות מוצר',
        rule: 'ירידה של {productFreqYoy_pctThreshold}%+ במספר החודשים שבהם הלקוח קונה מוצר מסוים, השנה לעומת אשתקד.',
        detail: 'נדרשים {productFreqYoy_minPriorMonths}+ חודשים עם רכישה אשתקד להשוואה. מוצר עם תחליף מוגדר נספר יחד עם התחליף שלו. חומרה גבוהה מעל {productFreqYoy_highPct}%.' },
      { title: 'סיכון ריכוזיות מוצרים',
        rule: '{concentration_pctThreshold}%+ ממחזור הלקוח מגיעים מ-{concentration_topN} מוצרים בלבד.',
        detail: 'נדרש מחזור לקוח כולל של {concentration_minRevenue}₪ לפחות. חומרה גבוהה מעל 85% ריכוזיות.' },
      { title: 'קצב רכישה לא סדיר',
        rule: 'מוצר שמהווה {irregularity_minRevenueShare}%+ ממחזור הלקוח ב-{irregularity_windowMonths} החודשים הקלנדריים האחרונים שהסתיימו במלואם ובאותם חודשים אשתקד גם יחד, אך נרכש בכמות לא עקבית מחודש לחודש באותה תקופה משולבת (מקדם שונות בכמות החודשית מעל {irregularity_cvThreshold}%).',
        detail: 'נדרשים {irregularity_minActiveMonths}+ חודשים עם רכישה מתוך שני החלונות יחד כדי שמקדם השונות ייחשב מבוסס. מוצר עם תחליף מוגדר נספר יחד עם התחליף שלו כיחידה אחת. הבדיקה כמותית (כמות חודשית), לא לפי מספר הימים בין רכישות. הזדמנות להציע ללקוח לעבור להזמנה קבועה של המוצר.' }
    ] },
  { type: 'peerGap', title: 'פער רכישה מול לקוחות דומים — תובנה 3',
    subrules: [
      { title: 'לקוחות תחת אותו לקוח מרכז',
        rule: 'הלקוח אינו קונה מוצר מסוים, בעוד {peerGap_pctThreshold}%+ מהלקוחות האחרים תחת אותו "לקוח מרכז" כן קונים אותו, ב-{peerGap_windowMonths} החודשים הקלנדריים האחרונים שהסתיימו במלואם.',
        detail: 'נדרשים {peerGap_minGroupSize}+ לקוחות פעילים תחת אותו לקוח מרכז כדי שהאחוז ייחשב מבוסס. הבדיקה היא לפי קוד מוצר מדויק, לא משפחת מוצר — אך לקוח שקונה מוצר תחליפי (טבלת "מוצרים תחליפיים") למוצר הנבדק אינו נחשב כבעל פער, כי הצורך שלו כבר מכוסה. חומרה גבוהה מעל {peerGap_highPct}%.' },
      { title: 'לקוחות מאותו סוג לקוח',
        rule: 'הלקוח אינו קונה מוצר מסוים, בעוד {peerGap_pctThreshold}%+ מהלקוחות האחרים מאותו "סוג לקוח" כן קונים אותו, ב-{peerGap_windowMonths} החודשים הקלנדריים האחרונים שהסתיימו במלואם.',
        detail: 'אותם תנאי סף וחריג תחליף כמו בבדיקה מול לקוח מרכז. אם שני המסלולים מתקיימים לאותו לקוח ומוצר, מופקת תובנה אחת משולבת שמזכירה את שני ההסברים, ולא שתי תובנות נפרדות.' }
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
    INSIGHT_RULES.forEach((r, idx) => {
      html += '<div class="rule-type-heading"' + (idx === 0 ? ' style="margin-top:0;"' : '') + '>' + Layout.escapeHtml(r.title) + '</div>';
      html += '<div class="rule-grid">';
      r.subrules.forEach((sub) => {
        html += '<div class="rule-subcard">' +
          '<div class="rule-subtitle">' + Layout.escapeHtml(sub.title) + '</div>' +
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
