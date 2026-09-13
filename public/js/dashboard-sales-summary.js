// Dashboard infographics built from the sales-full-report consolidation: KPI tiles,
// a monthly revenue trend (year-over-year by default, or period-vs-comparison-period
// when a period filter is active), and breakdown charts by customer/product
// classification. Every chart is clickable — it deep-links to the full sales report,
// pre-filtered to whatever bar/slice was clicked.
//
// The whole dashboard can be scoped to one customer and/or a date period (see
// dashboard-filters.js, which drives this via loadDashboardSalesSummary(filters)) —
// everything here is re-fetched and every chart destroyed and rebuilt on each call,
// since Chart.js refuses to reuse a canvas that already has a live chart on it.
//
// Primary-side reads as red, comparison-side as green (per a reference screenshot of
// red/green KPI cards) — kept the DASH_BLUE/DASH_PURPLE constant names (used in ~10
// places below each) to avoid a purely-cosmetic rename, matching app.css's --blue/
// --purple tokens which point at these same shades for the same reason.
const DASH_CHART_COLORS = ['#DE4B4B', '#B33A3A', '#1B2144', '#64748B', '#93A4C3', '#B9C1E4', '#0F172A'];
const DASH_BLUE = '#DE4B4B';
const DASH_PURPLE = '#2FA360';

const dashCharts = {};
function upsertChart(canvasId, config) {
  if (dashCharts[canvasId]) dashCharts[canvasId].destroy();
  dashCharts[canvasId] = new Chart(document.getElementById(canvasId), config);
}

function fmtMoneyShort(n) { return Math.round(n || 0).toLocaleString('he-IL') + ' ₪'; }

function reportUrl(params) {
  const q = new URLSearchParams(params).toString();
  return 'reports-full-sales.html' + (q ? '?' + q : '');
}


// Year-over-year indicator for the trend bar charts: one combined arrow + % + ₪
// label drawn above each month's bar (or pair of bars), comparing that month's value
// to the exact same calendar month one year earlier — not month-to-month within a
// series. Skipped for a month that hasn't fully ended yet (its total is partial and
// comparing it would be misleading), and whenever there's no year-earlier value to
// compare against.
function buildYoyEntries(n, getCurrent, getPrior) {
  const now = new Date();
  const out = [];
  for (let i = 0; i < n; i++) {
    const cur = getCurrent(i);
    const prior = getPrior(i);
    const meta = cur && cur.meta;
    if (!prior || !meta || new Date(meta.year, meta.month, 1) > now) continue;
    const curVal = cur.value;
    const delta = (curVal - prior) / prior;
    if (!isFinite(delta) || delta === 0) continue;
    out.push({ i, pct: Math.round(delta * 100), moneyDiff: Math.round(curVal - prior), up: delta > 0 });
  }
  return out;
}

// Draws a small triangular arrow with a gradient fill and a soft drop shadow (a
// simple stand-in for a "3D" look in a 2D canvas) beside the % figure, with the ₪
// figure on its own line above — centered above whichever bar(s) `dsIndices` point
// to for that month. The arrow sits to the side of the percentage rather than
// stacked on top of it, so the two never overlap regardless of font size.
function yoyDrawPlugin(entries, dsIndices) {
  return {
    id: 'yoyIndicator',
    afterDatasetsDraw(chart) {
      const ctx = chart.ctx;
      entries.forEach((e) => {
        const bars = dsIndices.map((dsIdx) => {
          const meta = chart.getDatasetMeta(dsIdx);
          return meta && !meta.hidden ? meta.data[e.i] : null;
        }).filter(Boolean);
        if (!bars.length) return;
        const props = bars.map((b) => b.getProps(['x', 'y'], true));
        const midX = props.reduce((a, p) => a + p.x, 0) / props.length;
        const topY = Math.min.apply(null, props.map((p) => p.y));
        const color = e.up ? '#1E9E5C' : '#DE4B4B';
        const lightColor = e.up ? '#9FE8BE' : '#F7B9B3';
        const size = 6;

        // Row 2 (closer to the bars): the arrow + percentage, side by side. Sign is
        // built as a trailing character on an explicit LTR string (rather than
        // relying on the number's own leading "-") — canvas text inherits the page's
        // RTL direction, which otherwise reorders a leading minus unpredictably.
        const pctBaselineY = topY - 6;
        const pctText = Math.abs(e.pct) + '%' + (e.up ? '+' : '-');
        ctx.font = '800 13.5px Assistant, Arial, sans-serif';
        const pctWidth = ctx.measureText(pctText).width;
        const gap = 4;
        const rowWidth = size * 2 + gap + pctWidth;
        const arrowCenterX = midX - rowWidth / 2 + size;
        const textStartX = arrowCenterX + size + gap;
        const arrowCenterY = pctBaselineY - 4;

        ctx.save();
        ctx.shadowColor = 'rgba(15,23,42,0.32)';
        ctx.shadowBlur = 2.5;
        ctx.shadowOffsetY = 1.2;
        const grad = ctx.createLinearGradient(arrowCenterX, arrowCenterY - size, arrowCenterX, arrowCenterY + size);
        if (e.up) { grad.addColorStop(0, lightColor); grad.addColorStop(1, color); }
        else { grad.addColorStop(0, color); grad.addColorStop(1, lightColor); }
        ctx.fillStyle = grad;
        ctx.beginPath();
        if (e.up) {
          ctx.moveTo(arrowCenterX, arrowCenterY - size * 0.6);
          ctx.lineTo(arrowCenterX + size * 0.6, arrowCenterY + size * 0.5);
          ctx.lineTo(arrowCenterX - size * 0.6, arrowCenterY + size * 0.5);
        } else {
          ctx.moveTo(arrowCenterX, arrowCenterY + size * 0.6);
          ctx.lineTo(arrowCenterX + size * 0.6, arrowCenterY - size * 0.5);
          ctx.lineTo(arrowCenterX - size * 0.6, arrowCenterY - size * 0.5);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        ctx.save();
        ctx.direction = 'ltr';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.font = '800 13.5px Assistant, Arial, sans-serif';
        ctx.fillStyle = color;
        ctx.fillText(pctText, textStartX, pctBaselineY);
        ctx.restore();

        // Row 1 (above row 2): the ₪ delta, smaller and muted. Same trailing-sign,
        // explicit-LTR approach as the percentage above, and "שח" spelled out rather
        // than the ₪ symbol (per explicit request for this indicator specifically).
        const moneyText = Math.abs(e.moneyDiff).toLocaleString('he-IL') + (e.moneyDiff >= 0 ? '+' : '-') + ' שח';
        ctx.save();
        ctx.direction = 'ltr';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.font = '700 11px Assistant, Arial, sans-serif';
        ctx.fillStyle = '#6A7093';
        ctx.fillText(moneyText, midX, pctBaselineY - 15);
        ctx.restore();
      });
    }
  };
}

// `onlyDsIndex`, when given, restricts the note to that one dataset's bars — the
// indicator is only ever drawn above specific bars (see `dsIndices` in
// yoyDrawPlugin), so the tooltip shouldn't claim to explain a bar it wasn't drawn on.
function yoyTooltipAfterLabel(entries, onlyDsIndex) {
  const byIndex = {};
  entries.forEach((e) => { byIndex[e.i] = e; });
  return (tooltipItem) => {
    if (onlyDsIndex != null && tooltipItem.datasetIndex !== onlyDsIndex) return undefined;
    const e = byIndex[tooltipItem.dataIndex];
    if (!e) return undefined;
    const sign = e.up ? '+' : '-';
    return 'לעומת אותו חודש אשתקד: ' + Math.abs(e.pct) + '%' + sign + ' (' + Math.abs(e.moneyDiff).toLocaleString('he-IL') + sign + ' שח)';
  };
}

// Draws each bar's own value just past its end (a small muted label), so the number
// reads at a glance without hovering for the tooltip — vertical bars get it centered
// above the bar, horizontal ones get it just past the bar's tip.
function barValueLabelPlugin(formatFn) {
  return {
    id: 'barValueLabel',
    afterDatasetsDraw(chart) {
      const isHorizontal = chart.options.indexAxis === 'y';
      const ctx = chart.ctx;
      chart.data.datasets.forEach((ds, dsIndex) => {
        const meta = chart.getDatasetMeta(dsIndex);
        if (meta.hidden) return;
        meta.data.forEach((bar, i) => {
          const value = ds.data[i];
          if (value == null) return;
          const props = bar.getProps(['x', 'y'], true);
          ctx.save();
          ctx.font = '700 11px Assistant, Arial, sans-serif';
          ctx.fillStyle = '#6A7093';
          if (isHorizontal) {
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(formatFn(value), props.x + 6, props.y);
          } else {
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(formatFn(value), props.x, props.y - 4);
          }
          ctx.restore();
        });
      });
    }
  };
}


// A field can hold several values now (multi-select) — a report link can only ever
// filter by one exact value per column, so it degrades gracefully to "no filter on
// this dimension" once more than one is picked; join(...) instead gives the display
// text a readable name (or a count) regardless of how many are selected.
function singleOrNull(arr) { return (arr && arr.length === 1) ? arr[0] : null; }
function joinOrCount(arr, names, countWord) {
  if (!arr || !arr.length) return null;
  if (arr.length === 1) return (names && names[0]) || arr[0];
  return arr.length + ' ' + countWord;
}

async function loadDashboardSalesSummary(filters) {
  filters = filters || {};
  const qs = new URLSearchParams();
  const setList = (key, arr) => { if (arr && arr.length) qs.set(key, arr.join(',')); };
  setList('customerNumber', filters.customer);
  setList('productCode', filters.product);
  setList('primaryClass', filters.primaryClass);
  setList('customerType', filters.customerType);
  setList('superType', filters.superType);
  setList('department', filters.department);
  setList('periodMonths', filters.periodMonths);
  setList('compareMonths', filters.compareMonths);
  setList('compareCustomerNumber', filters.compareCustomer);
  setList('compareProductCode', filters.compareProduct);
  setList('comparePrimaryClass', filters.comparePrimaryClass);
  setList('compareCustomerType', filters.compareCustomerType);
  setList('compareSuperType', filters.compareSuperType);
  setList('compareDepartment', filters.compareDepartment);
  setList('boughtProducts', filters.boughtProducts);
  setList('notBoughtProducts', filters.notBoughtProducts);
  const q = qs.toString();
  const res = await fetch('/api/dashboard-sales-summary' + (q ? '?' + q : ''), { credentials: 'include' });
  if (!res.ok) return;
  const s = await res.json();
  const customerLabel = joinOrCount(s.customerNumbers, s.customerNames, 'לקוחות');
  const productLabel = joinOrCount(s.productCodes, s.productNames, 'מוצרים');
  const primaryClassLabel = joinOrCount(s.primaryClasses, null, 'סיווגים ראשיים');
  const customerTypeLabel = joinOrCount(s.customerTypes, null, 'סוגי לקוח');
  const superTypeLabel = joinOrCount(s.superTypes, null, 'טיפוסי על');
  const departmentLabel = joinOrCount(s.departments, null, 'מחלקות מוצר');
  const suffix = (customerLabel ? (' — ' + customerLabel) : '') + (productLabel ? (' — ' + productLabel) : '')
    + (primaryClassLabel ? (' — ' + primaryClassLabel) : '') + (customerTypeLabel ? (' — ' + customerTypeLabel) : '')
    + (superTypeLabel ? (' — ' + superTypeLabel) : '') + (departmentLabel ? (' — ' + departmentLabel) : '');

  // Per-chart-card filter description: every chart's own title stays generic (set
  // separately per row below), while this line — shown inside each individual card —
  // spells out exactly which filters that specific side (primary or comparison) is
  // built from, so a viewer never has to scroll back up to the filter table to know
  // what a given bar/slice represents.
  function joinFilterParts(parts) { return parts.filter(Boolean).join(' • '); }
  const primaryFilterDesc = joinFilterParts([
    customerLabel ? ('לקוח: ' + customerLabel) : null,
    productLabel ? ('מוצר: ' + productLabel) : null,
    primaryClassLabel ? ('סיווג ראשי: ' + primaryClassLabel) : null,
    customerTypeLabel ? ('סוג לקוח: ' + customerTypeLabel) : null,
    superTypeLabel ? ('טיפוס על: ' + superTypeLabel) : null,
    departmentLabel ? ('מחלקת מוצר: ' + departmentLabel) : null,
    s.period ? ('תקופה: ' + s.period.label) : null,
    (s.boughtProductNames && s.boughtProductNames.length) ? ('קנו: ' + s.boughtProductNames.join(', ')) : null,
    (s.notBoughtProductNames && s.notBoughtProductNames.length) ? ('לא קנו: ' + s.notBoughtProductNames.join(', ')) : null
  ]) || 'כלל הנתונים, ללא סינון';
  // Same idea for the comparison side — computed here (rather than only where the
  // report-link params need it further down) so the trend chart's compare card can
  // use it too, not just the breakdown charts below.
  const compareCustomerLabel = joinOrCount(s.compareCustomerNumbers, s.compareCustomerNames, 'לקוחות');
  const compareProductLabel = joinOrCount(s.compareProductCodes, s.compareProductNames, 'מוצרים');
  const comparePrimaryClassLabel = joinOrCount(s.comparePrimaryClasses, null, 'סיווגים ראשיים');
  const compareCustomerTypeLabel = joinOrCount(s.compareCustomerTypes, null, 'סוגי לקוח');
  const compareSuperTypeLabel = joinOrCount(s.compareSuperTypes, null, 'טיפוסי על');
  const compareDepartmentLabel = joinOrCount(s.compareDepartments, null, 'מחלקות מוצר');
  const compareAxisLabel = comparePrimaryClassLabel ? ('סיווג ' + comparePrimaryClassLabel)
    : compareCustomerTypeLabel ? ('סוג לקוח ' + compareCustomerTypeLabel)
    : compareCustomerLabel ? ('הלקוח ' + compareCustomerLabel)
    : compareProductLabel ? ('המוצר ' + compareProductLabel)
    : compareSuperTypeLabel ? ('טיפוס על ' + compareSuperTypeLabel)
    : compareDepartmentLabel ? ('מחלקת מוצר ' + compareDepartmentLabel)
    : (s.comparePeriod ? s.comparePeriod.label : null);
  // Same single-axis label for the primary side's own KPI tiles, which previously
  // stated no filter at all (only the comparison tiles named what they were about).
  const primaryAxisLabel = primaryClassLabel ? ('סיווג ' + primaryClassLabel)
    : customerTypeLabel ? ('סוג לקוח ' + customerTypeLabel)
    : customerLabel ? ('הלקוח ' + customerLabel)
    : productLabel ? ('המוצר ' + productLabel)
    : superTypeLabel ? ('טיפוס על ' + superTypeLabel)
    : departmentLabel ? ('מחלקת מוצר ' + departmentLabel)
    : (s.period ? s.period.label : null);
  const compareFilterDesc = joinFilterParts([
    compareCustomerLabel ? ('לקוח: ' + compareCustomerLabel) : null,
    compareProductLabel ? ('מוצר: ' + compareProductLabel) : null,
    comparePrimaryClassLabel ? ('סיווג ראשי: ' + comparePrimaryClassLabel) : null,
    compareCustomerTypeLabel ? ('סוג לקוח: ' + compareCustomerTypeLabel) : null,
    compareSuperTypeLabel ? ('טיפוס על: ' + compareSuperTypeLabel) : null,
    compareDepartmentLabel ? ('מחלקת מוצר: ' + compareDepartmentLabel) : null,
    s.comparePeriod ? ('תקופה: ' + s.comparePeriod.label) : null
  ]) || 'יורש את סינון הבדיקה הראשית';

  const baseReportParams = Object.assign({},
    singleOrNull(s.customerNumbers) && { customerNumber: singleOrNull(s.customerNumbers) },
    singleOrNull(s.productCodes) && { productCode: singleOrNull(s.productCodes) },
    singleOrNull(s.primaryClasses) && { primaryClass: singleOrNull(s.primaryClasses) },
    singleOrNull(s.customerTypes) && { customerType: singleOrNull(s.customerTypes) }
  );
  const hasCustomerFilter = !!(s.customerNumbers && s.customerNumbers.length);
  const ct = s.compareTotals;

  // Each chart/chart-pair's own title (set per-row below) names only the metric it
  // shows, generically — the specific filters behind the numbers are spelled out
  // separately inside each card via primaryFilterDesc/compareFilterDesc above.
  if (s.period) {
    document.getElementById('monthlyTrendTitle').textContent = 'השוואת תקופות';
    document.getElementById('monthlyTrendSubtitle').textContent =
      'התקופה ' + s.period.label + (s.comparePeriod ? ' לעומת ' + s.comparePeriod.label : '') +
      '. לחצו על עמודה כדי לצפות בשורות המכירה של אותו חודש בדוח המלא. החץ מציין שינוי לעומת אותו חודש אשתקד (לחודשים שהסתיימו בלבד).';
    document.getElementById('salesSummaryTitle').textContent = 'תמונת מכירות — ' + s.period.label + suffix;
    document.getElementById('salesSummarySubtitle').textContent = 'מבוסס על שורות המכירה בתקופה ' + s.period.label + (customerLabel ? (' של ' + customerLabel) : '') + '. לחצו על כל פרוסה/עמודה כדי לצפות בשורות הרלוונטיות בדוח המלא.';
  } else {
    const mt = s.monthlyTimeline;
    const fmtKey = (mk) => { const [y, m] = mk.split('-'); return s.monthNames[+m - 1] + ' ' + y; };
    document.getElementById('monthlyTrendTitle').textContent = 'מחזור מכירות חודשי';
    document.getElementById('monthlyTrendSubtitle').textContent =
      'נתוני ' + fmtKey(mt.months[0]) + (mt.months.length > 1 ? ' עד ' + fmtKey(mt.months[mt.months.length - 1]) : '') +
      ', ברצף' + (mt.compareData ? ' — מוצג גם בהשוואה' : '') +
      '. לחצו על עמודה כדי לצפות בשורות המכירה של אותו חודש בדוח המלא. החץ מציין את שיעור השינוי של התקופה הנוכחית בלבד, לעומת אותו חודש אשתקד.';
    document.getElementById('salesSummaryTitle').textContent = (hasCustomerFilter ? 'תמונת מכירות — הלקוח הנבחר' : 'תמונת מכירות כוללת');
    document.getElementById('salesSummarySubtitle').textContent = hasCustomerFilter
      ? ('מבוסס על שורות המכירה של ' + customerLabel + ' בלבד. לחצו על כל פרוסה/עמודה כדי לצפות בשורות הרלוונטיות בדוח המלא.')
      : 'מבוסס על דוח המכירות המלא — כל שורות המכירות בצירוף נתוני הלקוחות והמוצרים. לחצו על כל פרוסה/עמודה כדי לצפות בשורות הרלוונטיות בדוח המלא.';
  }
  document.getElementById('monthlyTrendPrimaryDesc').textContent = primaryFilterDesc;
  document.getElementById('salesSummaryFullReportLink').href = reportUrl(baseReportParams);
  document.getElementById('superTypeRowTitle').textContent = 'מחזור לפי טיפוס על';
  document.getElementById('departmentRowTitle').textContent = 'מחזור לפי מחלקת מוצר';
  document.getElementById('topProductsRowTitle').textContent = hasCustomerFilter ? '10 המוצרים המובילים אצל הלקוח' : '5 המוצרים המובילים במחזור';
  document.getElementById('topCustomersRowTitle').textContent = hasCustomerFilter ? 'מחזור הלקוח הנבחר' : '5 הלקוחות המובילים במחזור';
  document.getElementById('superTypeTitle').textContent = primaryFilterDesc;
  document.getElementById('departmentTitle').textContent = primaryFilterDesc;
  document.getElementById('topProductsTitle').textContent = primaryFilterDesc;
  document.getElementById('topCustomersTitle').textContent = primaryFilterDesc;

  // A single selected month can be expressed as the full report's own year/month
  // filter; a multi-month period has no equivalent there, so the tile link degrades
  // gracefully to customer-only filtering in that case.
  function singleMonthParams(periodInfo) {
    if (!periodInfo || periodInfo.months.length !== 1) return {};
    const [y, m] = periodInfo.months[0].split('-');
    return { year: y, month: String(Number(m)) };
  }
  const curReportParams = Object.assign({}, baseReportParams, singleMonthParams(s.period));
  // The comparison side's customer identity (customerNumber/primaryClass/customerType)
  // is one bundle: if the user gave ANY compare-specific identity field, use exactly
  // that bundle; otherwise inherit the primary side's identity wholesale — matching
  // the backend's own fallback logic exactly (see buildEntityWhere in
  // dashboardSalesSummary.js). The product dimension falls back independently. Each
  // is still single-value-only for the report link, same degrade rule as above.
  const hasCompareIdentity = !!((s.compareCustomerNumbers && s.compareCustomerNumbers.length) || (s.comparePrimaryClasses && s.comparePrimaryClasses.length) || (s.compareCustomerTypes && s.compareCustomerTypes.length));
  const compareBaseReportParams = {};
  if (hasCompareIdentity) {
    if (singleOrNull(s.comparePrimaryClasses)) compareBaseReportParams.primaryClass = singleOrNull(s.comparePrimaryClasses);
    if (singleOrNull(s.compareCustomerTypes)) compareBaseReportParams.customerType = singleOrNull(s.compareCustomerTypes);
    if (singleOrNull(s.compareCustomerNumbers)) compareBaseReportParams.customerNumber = singleOrNull(s.compareCustomerNumbers);
  } else {
    if (singleOrNull(s.primaryClasses)) compareBaseReportParams.primaryClass = singleOrNull(s.primaryClasses);
    if (singleOrNull(s.customerTypes)) compareBaseReportParams.customerType = singleOrNull(s.customerTypes);
    if (singleOrNull(s.customerNumbers)) compareBaseReportParams.customerNumber = singleOrNull(s.customerNumbers);
  }
  const cmpProductSingle = singleOrNull(s.compareProductCodes) || singleOrNull(s.productCodes);
  if (cmpProductSingle) compareBaseReportParams.productCode = cmpProductSingle;
  const compareReportParams = Object.assign({}, compareBaseReportParams, singleMonthParams(s.comparePeriod));

  // Color encodes which side a tile belongs to — blue for the primary check, purple
  // for its comparison — rather than which metric it is, so the two sides read as two
  // visually distinct groups at a glance (matching the same blue/purple split used on
  // the filter table above).
  const primSuffix = primaryAxisLabel ? (' — ' + primaryAxisLabel) : '';
  const kpiTiles = [
    ['blue', 'v-blue', fmtMoneyShort(s.totalRevenue), (s.period ? 'מכירות תקופה נוכחית' : 'מכירות') + primSuffix + ' (ש"ח)', reportUrl(curReportParams)],
    ['blue', 'v-blue', s.activeProductCount.toLocaleString('he-IL'), 'כמות מוצרים שנמכרו' + (s.period ? ' בתקופה נוכחית' : '') + primSuffix, reportUrl(curReportParams)]
  ];
  if (ct) {
    const cmpSuffix = compareAxisLabel ? (' — ' + compareAxisLabel) : '';
    kpiTiles.push(
      ['purple', 'v-purple', fmtMoneyShort(ct.totalRevenue), 'מכירות להשוואה' + cmpSuffix + ' (ש"ח)', reportUrl(compareReportParams)],
      ['purple', 'v-purple', ct.activeProductCount.toLocaleString('he-IL'), 'כמות מוצרים שנמכרו להשוואה' + cmpSuffix, reportUrl(compareReportParams)]
    );
  }

  document.getElementById('salesSummaryKpiGrid').innerHTML = kpiTiles.map(([dot, cls, value, desc, href]) => (
    '<a class="kpi-card" href="' + href + '">' +
    '<div class="kpi-blob" style="background:var(--' + dot + '-dot);"></div>' +
    '<div class="kpi-blob b2" style="background:var(--' + dot + ');"></div>' +
    '<div class="kpi-value ' + cls + '">' + Layout.escapeHtml(String(value)) + '</div>' +
    '<div class="kpi-desc">' + Layout.escapeHtml(desc) + '</div>' +
    '</a>'
  )).join('');

  // Shows/hides a chart row's second (comparison) card and widens/narrows the row
  // accordingly — one full-width chart when only primary filters are set, two
  // side-by-side (each shrunk to make room) as soon as any comparison is active.
  // Destroys the compare chart instance when hiding it so a later re-show always
  // starts from a clean canvas. Used by every chart on the dashboard that has a
  // primary/comparison pair (the trend chart and the four breakdown charts below it).
  function toggleCompareChart(rowId, cardId, canvasId, show) {
    const row = document.getElementById(rowId);
    const card = document.getElementById(cardId);
    if (row) row.style.gridTemplateColumns = show ? '1fr 1fr' : '1fr';
    if (card) card.style.display = show ? '' : 'none';
    if (!show && dashCharts[canvasId]) { dashCharts[canvasId].destroy(); delete dashCharts[canvasId]; }
  }

  // Reset before either branch below decides whether to show it — only the
  // period-vs-comparison-period case (right below) ever populates it.
  const trendCompareBadge = document.getElementById('monthlyTrendCompareBadge');
  trendCompareBadge.style.display = 'none';

  if (s.periodTrend) {
    // Period vs comparison-period, each its own chart with its own real calendar
    // month labels — the two ranges don't have to line up (a quarter vs some
    // unrelated pair of months is valid), so each chart faithfully reflects only the
    // months actually selected on that side, rather than a shared "month 1/2/3"
    // position that would misrepresent whichever side it doesn't match.
    const pt = s.periodTrend;
    const labels = pt.periodMonths.map((m) => s.monthNames[m.month - 1] + ' ' + m.year);
    // Always vs. the exact same calendar month one year earlier (pt.yoyData), drawn
    // above the period's own bar — independent of whatever comparison series is shown.
    const ptYoyEntries = buildYoyEntries(pt.periodMonths.length,
      (i) => ({ value: pt.periodData[i], meta: pt.periodMonths[i] }),
      (i) => pt.yoyData[i]
    );
    upsertChart('monthlyTrendChart', {
      type: 'bar',
      data: { labels, datasets: [{ label: pt.periodLabel, data: pt.periodData, backgroundColor: DASH_BLUE, borderRadius: 4 }] },
      plugins: [yoyDrawPlugin(ptYoyEntries, [0])],
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 38 } },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { afterLabel: yoyTooltipAfterLabel(ptYoyEntries, 0) } }
        },
        scales: { y: { ticks: { callback: (v) => v.toLocaleString('he-IL') } } },
        onClick: function (evt, elements) {
          if (!elements.length) return;
          const m = pt.periodMonths[elements[0].index];
          if (!m || !window.applyDashboardPeriodFilter) return;
          window.applyDashboardPeriodFilter(m.year, m.month, false);
        },
        onHover: (evt, elements) => { evt.native.target.style.cursor = elements.length ? 'pointer' : 'default'; }
      }
    });
    toggleCompareChart('monthlyTrendRow', 'monthlyTrendCompareCard', 'monthlyTrendCompareChart', !!pt.compareData);
    if (pt.compareData) {
      document.getElementById('monthlyTrendCompareChartTitle').textContent = compareFilterDesc;
      const cmpLabels = pt.compareMonths.map((m) => s.monthNames[m.month - 1] + ' ' + m.year);
      upsertChart('monthlyTrendCompareChart', {
        type: 'bar',
        data: { labels: cmpLabels, datasets: [{ label: pt.compareLabel, data: pt.compareData, backgroundColor: DASH_PURPLE, borderRadius: 4 }] },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { ticks: { callback: (v) => v.toLocaleString('he-IL') } } },
          onClick: function (evt, elements) {
            if (!elements.length) return;
            const m = pt.compareMonths[elements[0].index];
            if (!m || !window.applyDashboardPeriodFilter) return;
            window.applyDashboardPeriodFilter(m.year, m.month, true);
          },
          onHover: (evt, elements) => { evt.native.target.style.cursor = elements.length ? 'pointer' : 'default'; }
        }
      });
      // The headline number the whole two-chart split exists to show — the total
      // change between the two periods — floated right over the seam between them
      // so it can't be missed or require mentally subtracting the two totals.
      const curTotal = pt.periodData.reduce((a, v) => a + v, 0);
      const cmpTotal = pt.compareData.reduce((a, v) => a + v, 0);
      const diff = curTotal - cmpTotal;
      const dir = diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat';
      const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '—';
      const pctText = cmpTotal ? ((dir === 'up' ? '+' : '') + Math.round((diff / cmpTotal) * 100) + '%') : '';
      trendCompareBadge.innerHTML =
        '<span class="tcb-pct tcb-' + dir + '">' + arrow + (pctText ? ' ' + pctText : '') + '</span>' +
        '<span class="tcb-money">' + (diff >= 0 ? '+' : '') + Math.round(diff).toLocaleString('he-IL') + ' ₪</span>';
      trendCompareBadge.style.display = '';
    }
  } else {
    // Continuous monthly revenue trend across the whole sales history — one bar per
    // month in sequence, not grouped by calendar month across years. A year-over-year
    // indicator is drawn above every month that has a same-calendar-month-last-year
    // value to compare against (buildYoyEntries already skips months with none, e.g.
    // the timeline's first year), not just the single most recent one — so a viewer
    // never has to click into a period filter just to see how each month fared.
    const mt = s.monthlyTimeline;
    const n = mt.months.length;
    const labels = mt.months.map((mk) => { const [y, m] = mk.split('-'); return s.monthNames[+m - 1] + ' ' + y; });
    const monthMeta = mt.months.map((mk) => { const [y, m] = mk.split('-'); return { year: +y, month: +m }; });
    const timelineYoyEntries = buildYoyEntries(n,
      (i) => ({ value: mt.data[i], meta: monthMeta[i] }),
      (i) => mt.yoyData[i]
    );
    // The per-bar YoY indicator only makes sense as the "how did each month do"
    // story when this is the only chart on show — once a comparison chart is also
    // displayed alongside it, that side-by-side split is already the comparison, and
    // a dozen extra per-bar arrows on the primary chart would just add noise.
    const activeYoyEntries = mt.compareData ? [] : timelineYoyEntries;
    upsertChart('monthlyTrendChart', {
      type: 'bar',
      data: { labels, datasets: [{ label: 'מחזור', data: mt.data, backgroundColor: DASH_BLUE, borderRadius: 4 }] },
      plugins: [yoyDrawPlugin(activeYoyEntries, [0])],
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 38 } },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { afterLabel: yoyTooltipAfterLabel(activeYoyEntries, 0) } }
        },
        scales: { y: { ticks: { callback: (v) => v.toLocaleString('he-IL') } } },
        onClick: function (evt, elements) {
          if (!elements.length || !window.applyDashboardPeriodFilter) return;
          const m = monthMeta[elements[0].index];
          window.applyDashboardPeriodFilter(m.year, m.month, false);
        },
        onHover: (evt, elements) => { evt.native.target.style.cursor = elements.length ? 'pointer' : 'default'; }
      }
    });
    toggleCompareChart('monthlyTrendRow', 'monthlyTrendCompareCard', 'monthlyTrendCompareChart', !!mt.compareData);
    if (mt.compareData) {
      document.getElementById('monthlyTrendCompareChartTitle').textContent = compareFilterDesc;
      upsertChart('monthlyTrendCompareChart', {
        type: 'bar',
        data: { labels, datasets: [{ label: compareAxisLabel || 'השוואה', data: mt.compareData, backgroundColor: DASH_PURPLE, borderRadius: 4 }] },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { ticks: { callback: (v) => v.toLocaleString('he-IL') } } },
          onClick: function (evt, elements) {
            if (!elements.length || !window.applyDashboardPeriodFilter) return;
            const m = monthMeta[elements[0].index];
            window.applyDashboardPeriodFilter(m.year, m.month, true);
          },
          onHover: (evt, elements) => { evt.native.target.style.cursor = elements.length ? 'pointer' : 'default'; }
        }
      });
    }
  }

  const legendOpts = { legend: { position: 'bottom', rtl: true, labels: { font: { family: 'Assistant' } } } };
  // Clicking a bar/slice narrows the dashboard's own filters (see
  // applyDashboardFilterByDimension in dashboard-filters.js) instead of navigating to
  // the full sales report — for every dimension the filter table has a field for.
  const DASH_FILTERABLE_DIMENSIONS = { customer: true, product: true, superType: true, department: true };
  function oneBreakdownChart(canvasId, rows, filterKey, type, color, isCompare) {
    const clickable = DASH_FILTERABLE_DIMENSIONS[filterKey] && !!window.applyDashboardFilterByDimension;
    const cfg = {
      type,
      data: {
        labels: rows.map((r) => r.name),
        datasets: [{
          label: 'מחזור', data: rows.map((r) => r.revenue),
          backgroundColor: type === 'doughnut' ? DASH_CHART_COLORS : color,
          borderRadius: type === 'bar' ? 6 : undefined
        }]
      },
      options: {
        indexAxis: type === 'bar' ? 'y' : undefined,
        responsive: true, maintainAspectRatio: false,
        layout: type === 'bar' ? { padding: { right: 46 } } : undefined,
        plugins: type === 'doughnut' ? legendOpts : { legend: { display: false } },
        scales: type === 'bar' ? { x: { ticks: { callback: (v) => v.toLocaleString('he-IL') } } } : undefined,
        onClick: clickable ? function (evt, elements) {
          if (!elements.length) return;
          window.applyDashboardFilterByDimension(filterKey, rows[elements[0].index].name, isCompare);
        } : undefined,
        onHover: clickable ? (evt, elements) => { evt.native.target.style.cursor = elements.length ? 'pointer' : 'default'; } : undefined
      }
    };
    if (type === 'bar') cfg.plugins = [barValueLabelPlugin((v) => Math.round(v).toLocaleString('he-IL'))];
    upsertChart(canvasId, cfg);
  }
  // Each breakdown chart follows the same primary/comparison-pair pattern as the
  // trend chart above: full width alone, or split with a comparison version (same
  // breakdown, computed from the compare-side data) whenever a comparison is active.
  function breakdownChart(rowId, canvasId, compareCanvasId, compareCardId, compareTitleId, rows, compareRows, filterKey, type, color) {
    oneBreakdownChart(canvasId, rows, filterKey, type, color, false);
    toggleCompareChart(rowId, compareCardId, compareCanvasId, !!compareRows);
    if (compareRows) {
      document.getElementById(compareTitleId).textContent = compareFilterDesc;
      oneBreakdownChart(compareCanvasId, compareRows, filterKey, type, DASH_PURPLE, true);
    }
  }

  breakdownChart('superTypeRow', 'superTypeChart', 'superTypeCompareChart', 'superTypeCompareCard', 'superTypeCompareTitle', s.bySuperType, s.compareBySuperType, 'superType', 'bar', DASH_BLUE);
  breakdownChart('departmentRow', 'departmentChart', 'departmentCompareChart', 'departmentCompareCard', 'departmentCompareTitle', s.byDepartment, s.compareByDepartment, 'department', 'bar', DASH_BLUE);

  function oneRankedChart(canvasId, rows, color, filterKey, isCompare) {
    const clickable = !!window.applyDashboardFilterByDimension;
    upsertChart(canvasId, {
      type: 'bar',
      data: { labels: rows.map((r) => r.name), datasets: [{ label: 'מחזור', data: rows.map((r) => r.revenue), backgroundColor: color, borderRadius: 6 }] },
      plugins: [barValueLabelPlugin((v) => Math.round(v).toLocaleString('he-IL'))],
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        layout: { padding: { right: 46 } },
        plugins: { legend: { display: false } },
        scales: { x: { ticks: { callback: (v) => v.toLocaleString('he-IL') } } },
        onClick: clickable ? function (evt, elements) {
          if (!elements.length) return;
          window.applyDashboardFilterByDimension(filterKey, rows[elements[0].index].code, isCompare);
        } : undefined,
        onHover: clickable ? (evt, elements) => { evt.native.target.style.cursor = elements.length ? 'pointer' : 'default'; } : undefined
      }
    });
  }

  oneRankedChart('topCustomersChart', s.topCustomers, DASH_BLUE, 'customer', false);
  toggleCompareChart('topCustomersRow', 'topCustomersCompareCard', 'topCustomersCompareChart', !!s.compareTopCustomers);
  if (s.compareTopCustomers) {
    document.getElementById('topCustomersCompareTitle').textContent = compareFilterDesc;
    oneRankedChart('topCustomersCompareChart', s.compareTopCustomers, DASH_PURPLE, 'customer', true);
  }

  oneRankedChart('topProductsChart', s.topProducts, DASH_BLUE, 'product', false);
  toggleCompareChart('topProductsRow', 'topProductsCompareCard', 'topProductsCompareChart', !!s.compareTopProducts);
  if (s.compareTopProducts) {
    document.getElementById('topProductsCompareTitle').textContent = compareFilterDesc;
    oneRankedChart('topProductsCompareChart', s.compareTopProducts, DASH_PURPLE, 'product', true);
  }

  return s;
}

