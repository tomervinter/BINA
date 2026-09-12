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
// A single restrained blue/navy/slate palette throughout — no per-category rainbow —
// to keep the look formal and consistent with the rest of the app's brand color.
const DASH_CHART_COLORS = ['#3D5CF5', '#2C48D8', '#1B2144', '#64748B', '#93A4C3', '#B9C1E4', '#0F172A'];
const DASH_BLUE = '#3D5CF5';
const DASH_NAVY = '#1B2144';
const DASH_SLATE = '#64748B';
// Year-over-year / period-vs-comparison trend bars: the primary series is always the
// most prominent brand blue, older/comparison series fade to muted navy/slate/gray.
const YEAR_SERIES_COLORS = ['#3D5CF5', '#1B2144', '#64748B', '#93A4C3', '#2C48D8', '#B9C1E4', '#0F172A'];

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

// Chart.js click handler factory: resolves the clicked element back to its data label
// (bar/donut slice) and navigates. Works for both single- and multi-dataset charts.
function onChartClick(getUrl) {
  return function (evt, elements, chart) {
    if (!elements.length) return;
    const el = elements[0];
    const label = chart.data.labels[el.index];
    const url = getUrl(label, el);
    if (url) window.location.href = url;
  };
}

// Appends a "(+12% לעומת <label>)" note when a comparison value is available and
// non-zero; otherwise returns an empty string.
function deltaNote(current, compareVal, compareLabel) {
  if (compareVal == null || !compareLabel) return '';
  if (!compareVal) return '';
  const delta = ((current - compareVal) / compareVal) * 100;
  const sign = delta >= 0 ? '+' : '';
  return ' (' + sign + Math.round(delta) + '% לעומת ' + compareLabel + ')';
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
// simple stand-in for a "3D" look in a 2D canvas) plus the % and ₪ figures, centered
// above whichever bar(s) `dsIndices` point to for that month.
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
        const arrowY = topY - 15;
        const size = 4.5;

        ctx.save();
        ctx.shadowColor = 'rgba(15,23,42,0.32)';
        ctx.shadowBlur = 2.5;
        ctx.shadowOffsetY = 1.2;
        const grad = ctx.createLinearGradient(midX, arrowY - size, midX, arrowY + size);
        if (e.up) { grad.addColorStop(0, lightColor); grad.addColorStop(1, color); }
        else { grad.addColorStop(0, color); grad.addColorStop(1, lightColor); }
        ctx.fillStyle = grad;
        ctx.beginPath();
        if (e.up) {
          ctx.moveTo(midX, arrowY - size);
          ctx.lineTo(midX + size, arrowY + size * 0.6);
          ctx.lineTo(midX - size, arrowY + size * 0.6);
        } else {
          ctx.moveTo(midX, arrowY + size);
          ctx.lineTo(midX + size, arrowY - size * 0.6);
          ctx.lineTo(midX - size, arrowY - size * 0.6);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        ctx.save();
        ctx.textAlign = 'center';
        ctx.font = '700 9.5px Assistant, Arial, sans-serif';
        ctx.fillStyle = color;
        ctx.textBaseline = 'bottom';
        ctx.fillText((e.up ? '+' : '') + e.pct + '%', midX, topY - 4);
        ctx.font = '600 8px Assistant, Arial, sans-serif';
        ctx.fillStyle = '#6A7093';
        ctx.fillText((e.moneyDiff >= 0 ? '+' : '') + e.moneyDiff.toLocaleString('he-IL') + '₪', midX, arrowY - size - 1);
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
    const sign = e.up ? '+' : '';
    return 'לעומת אותו חודש אשתקד: ' + sign + e.pct + '% (' + sign + e.moneyDiff.toLocaleString('he-IL') + '₪)';
  };
}

async function loadDashboardSalesSummary(filters) {
  filters = filters || {};
  const qs = new URLSearchParams();
  if (filters.customer) qs.set('customerNumber', filters.customer);
  if (filters.periodMonths && filters.periodMonths.length) qs.set('periodMonths', filters.periodMonths.join(','));
  if (filters.compareMonths && filters.compareMonths.length) qs.set('compareMonths', filters.compareMonths.join(','));
  const q = qs.toString();
  const res = await fetch('/api/dashboard-sales-summary' + (q ? '?' + q : ''), { credentials: 'include' });
  if (!res.ok) return;
  const s = await res.json();
  const suffix = s.customerName ? (' — ' + s.customerName) : '';
  const baseReportParams = s.customerNumber ? { customerNumber: s.customerNumber } : {};
  const ct = s.compareTotals;

  if (s.period) {
    document.getElementById('monthlyTrendTitle').textContent = 'השוואת תקופות' + suffix;
    document.getElementById('monthlyTrendSubtitle').textContent =
      'התקופה ' + s.period.label + (s.comparePeriod ? ' לעומת ' + s.comparePeriod.label : '') +
      '. לחצו על עמודה כדי לצפות בשורות המכירה של אותו חודש בדוח המלא. החץ מציין שינוי לעומת אותו חודש אשתקד (לחודשים שהסתיימו בלבד).';
    document.getElementById('salesSummaryTitle').textContent = 'תמונת מכירות — ' + s.period.label + suffix;
    document.getElementById('salesSummarySubtitle').textContent = 'מבוסס על שורות המכירה בתקופה ' + s.period.label + (s.customerNumber ? (' של ' + s.customerName) : '') + '. לחצו על כל פרוסה/עמודה כדי לצפות בשורות הרלוונטיות בדוח המלא.';
  } else {
    const years = s.yearlyTrend.map((y) => y.year);
    document.getElementById('monthlyTrendTitle').textContent = (years.length > 1 ? 'השוואת מחזור חודשי בין השנים' : 'מחזור מכירות לפי חודשים') + suffix;
    document.getElementById('monthlyTrendSubtitle').textContent =
      (years.length > 1 ? 'השוואה חודשית בין ' + years.join(', ') : 'נתוני שנת ' + years[0]) +
      '. לחצו על עמודה כדי לצפות בשורות המכירה של אותו חודש בדוח המלא. החץ מציין שינוי לעומת אותו חודש אשתקד (לחודשים שהסתיימו בלבד).';
    document.getElementById('salesSummaryTitle').textContent = (s.customerNumber ? 'תמונת מכירות — הלקוח הנבחר' : 'תמונת מכירות כוללת');
    document.getElementById('salesSummarySubtitle').textContent = s.customerNumber
      ? ('מבוסס על שורות המכירה של ' + s.customerName + ' בלבד. לחצו על כל פרוסה/עמודה כדי לצפות בשורות הרלוונטיות בדוח המלא.')
      : 'מבוסס על דוח המכירות המלא — כל שורות המכירות בצירוף נתוני הלקוחות והמוצרים. לחצו על כל פרוסה/עמודה כדי לצפות בשורות הרלוונטיות בדוח המלא.';
  }
  document.getElementById('salesSummaryFullReportLink').href = reportUrl(baseReportParams);
  document.getElementById('superTypeTitle').textContent = 'מחזור לפי טיפוס על' + suffix;
  document.getElementById('departmentTitle').textContent = 'מחזור לפי מחלקת מוצר' + suffix;
  document.getElementById('topProductsTitle').textContent = s.customerNumber ? 'המוצרים המובילים אצל הלקוח' : '5 המוצרים המובילים במחזור';
  document.getElementById('topCustomersTitle').textContent = s.customerNumber ? 'מחזור הלקוח הנבחר' : '5 הלקוחות המובילים במחזור';

  document.getElementById('salesSummaryKpiGrid').innerHTML = [
    ['blue', 'v-blue', fmtMoneyShort(s.totalRevenue), (s.customerNumber ? 'מחזור הלקוח' : 'מחזור כולל') + deltaNote(s.totalRevenue, ct && ct.totalRevenue, s.comparePeriod && s.comparePeriod.label)],
    ['blue', 'v-blue', Math.round(s.totalQuantity || 0).toLocaleString('he-IL'), 'כמות שנמכרה בסך הכול' + deltaNote(s.totalQuantity, ct && ct.totalQuantity, s.comparePeriod && s.comparePeriod.label)],
    ['green', 'v-green', s.activeCustomerCount.toLocaleString('he-IL'), s.customerNumber ? 'לקוח מוצג' : 'לקוחות עם רכישות'],
    ['green', 'v-green', s.activeProductCount.toLocaleString('he-IL'), 'מוצרים שנמכרו']
  ].map(([dot, cls, value, desc]) => (
    '<div class="kpi-card">' +
    '<div class="kpi-blob" style="background:var(--' + dot + '-dot);"></div>' +
    '<div class="kpi-blob b2" style="background:var(--' + dot + ');"></div>' +
    '<div class="kpi-value ' + cls + '">' + Layout.escapeHtml(String(value)) + '</div>' +
    '<div class="kpi-desc">' + Layout.escapeHtml(desc) + '</div>' +
    '</div>'
  )).join('');

  if (s.periodTrend) {
    // Period vs comparison-period: aligned by relative month position (month 1 of
    // period vs month 1 of comparison, etc.), since the two ranges are usually offset
    // on purpose (e.g. this quarter vs the same quarter last year).
    const pt = s.periodTrend;
    const n = Math.max(pt.periodMonths.length, pt.compareMonths ? pt.compareMonths.length : 0);
    const labels = Array.from({ length: n }, (_, i) => 'חודש ' + (i + 1));
    const datasets = [{ label: pt.periodLabel, data: pt.periodData, backgroundColor: DASH_BLUE, borderRadius: 4 }];
    if (pt.compareData) datasets.push({ label: pt.compareLabel, data: pt.compareData, backgroundColor: DASH_NAVY, borderRadius: 4 });
    // Always vs. the exact same calendar month one year earlier (pt.yoyData), drawn
    // above the period's own bar — independent of whatever comparison series is shown.
    const ptYoyEntries = buildYoyEntries(pt.periodMonths.length,
      (i) => ({ value: pt.periodData[i], meta: pt.periodMonths[i] }),
      (i) => pt.yoyData[i]
    );
    upsertChart('monthlyTrendChart', {
      type: 'bar',
      data: { labels, datasets },
      plugins: [yoyDrawPlugin(ptYoyEntries, [0])],
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 26 } },
        plugins: {
          legend: { position: 'bottom', rtl: true, labels: { font: { family: 'Assistant' } } },
          tooltip: { callbacks: { afterLabel: yoyTooltipAfterLabel(ptYoyEntries, 0) } }
        },
        scales: { y: { ticks: { callback: (v) => v.toLocaleString('he-IL') } } },
        onClick: function (evt, elements) {
          if (!elements.length) return;
          const el = elements[0];
          const months = el.datasetIndex === 0 ? pt.periodMonths : pt.compareMonths;
          const m = months && months[el.index];
          if (!m) return;
          window.location.href = reportUrl(Object.assign({}, baseReportParams, { year: m.year, month: m.month }));
        },
        onHover: (evt, elements) => { evt.native.target.style.cursor = elements.length ? 'pointer' : 'default'; }
      }
    });
  } else {
    // Year-over-year monthly revenue trend, one bar series per calendar year that has
    // data — click a bar to see that year+month's rows in the full report.
    const yearlyDatasets = s.yearlyTrend.map((yr, i) => ({
      label: String(yr.year),
      data: yr.data,
      backgroundColor: YEAR_SERIES_COLORS[(s.yearlyTrend.length - 1 - i) % YEAR_SERIES_COLORS.length],
      borderRadius: 4
    }));
    // Year-over-year indicator compares the most recent year to the one immediately
    // before it (if present among the displayed years), drawn centered above that
    // pair of bars for each month — not month-to-month within either series.
    const latestIdx = s.yearlyTrend.length - 1;
    const latestYear = s.yearlyTrend[latestIdx].year;
    const priorIdx = s.yearlyTrend.findIndex((yr) => yr.year === latestYear - 1);
    const yearlyYoyEntries = buildYoyEntries(12,
      (i) => ({ value: s.yearlyTrend[latestIdx].data[i], meta: { year: latestYear, month: i + 1 } }),
      (i) => priorIdx >= 0 ? s.yearlyTrend[priorIdx].data[i] : undefined
    );
    const yearlyYoyDsIndices = priorIdx >= 0 ? [latestIdx, priorIdx] : [latestIdx];
    upsertChart('monthlyTrendChart', {
      type: 'bar',
      data: { labels: s.monthNames, datasets: yearlyDatasets },
      plugins: [yoyDrawPlugin(yearlyYoyEntries, yearlyYoyDsIndices)],
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 26 } },
        plugins: {
          legend: { position: 'bottom', rtl: true, labels: { font: { family: 'Assistant' } } },
          tooltip: { callbacks: { afterLabel: yoyTooltipAfterLabel(yearlyYoyEntries, latestIdx) } }
        },
        scales: { y: { ticks: { callback: (v) => v.toLocaleString('he-IL') } } },
        onClick: function (evt, elements) {
          if (!elements.length) return;
          const el = elements[0];
          const yr = s.yearlyTrend[el.datasetIndex];
          window.location.href = reportUrl(Object.assign({}, baseReportParams, { year: yr.year, month: el.index + 1 }));
        },
        onHover: (evt, elements) => { evt.native.target.style.cursor = elements.length ? 'pointer' : 'default'; }
      }
    });
  }

  const legendOpts = { legend: { position: 'bottom', rtl: true, labels: { font: { family: 'Assistant' } } } };
  function breakdownChart(canvasId, rows, filterKey, type, color) {
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
        plugins: type === 'doughnut' ? legendOpts : { legend: { display: false } },
        scales: type === 'bar' ? { x: { ticks: { callback: (v) => v.toLocaleString('he-IL') } } } : undefined,
        onClick: onChartClick((label) => reportUrl(Object.assign({}, baseReportParams, { [filterKey]: label }))),
        onHover: (evt, elements) => { evt.native.target.style.cursor = elements.length ? 'pointer' : 'default'; }
      }
    };
    upsertChart(canvasId, cfg);
  }

  breakdownChart('superTypeChart', s.bySuperType, 'superType', 'bar', DASH_BLUE);
  breakdownChart('departmentChart', s.byDepartment, 'department', 'bar', DASH_NAVY);

  upsertChart('topCustomersChart', {
    type: 'bar',
    data: { labels: s.topCustomers.map((r) => r.name), datasets: [{ label: 'מחזור', data: s.topCustomers.map((r) => r.revenue), backgroundColor: DASH_BLUE, borderRadius: 6 }] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { ticks: { callback: (v) => v.toLocaleString('he-IL') } } },
      onClick: function (evt, elements) {
        if (!elements.length) return;
        const c = s.topCustomers[elements[0].index];
        window.location.href = reportUrl({ customerNumber: c.code });
      },
      onHover: (evt, elements) => { evt.native.target.style.cursor = elements.length ? 'pointer' : 'default'; }
    }
  });

  upsertChart('topProductsChart', {
    type: 'bar',
    data: { labels: s.topProducts.map((r) => r.name), datasets: [{ label: 'מחזור', data: s.topProducts.map((r) => r.revenue), backgroundColor: DASH_SLATE, borderRadius: 6 }] },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: { x: { ticks: { callback: (v) => v.toLocaleString('he-IL') } } },
      onClick: function (evt, elements) {
        if (!elements.length) return;
        const p = s.topProducts[elements[0].index];
        window.location.href = reportUrl(Object.assign({}, baseReportParams, { productCode: p.code }));
      },
      onHover: (evt, elements) => { evt.native.target.style.cursor = elements.length ? 'pointer' : 'default'; }
    }
  });
}

(function () {
  const params = new URLSearchParams(window.location.search);
  loadDashboardSalesSummary({
    customer: params.get('customer') || null,
    periodMonths: (params.get('periodMonths') || '').split(',').filter(Boolean),
    compareMonths: (params.get('compareMonths') || '').split(',').filter(Boolean)
  });
})();
