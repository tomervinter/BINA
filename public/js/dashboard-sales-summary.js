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

        // Row 2 (closer to the bars): the arrow + percentage, side by side.
        const pctBaselineY = topY - 6;
        const pctText = (e.up ? '+' : '') + e.pct + '%';
        ctx.font = '800 12px Assistant, Arial, sans-serif';
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
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.font = '800 12px Assistant, Arial, sans-serif';
        ctx.fillStyle = color;
        ctx.fillText(pctText, textStartX, pctBaselineY);
        ctx.restore();

        // Row 1 (above row 2): the ₪ delta, smaller and muted.
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.font = '700 9.5px Assistant, Arial, sans-serif';
        ctx.fillStyle = '#6A7093';
        ctx.fillText((e.moneyDiff >= 0 ? '+' : '') + e.moneyDiff.toLocaleString('he-IL') + '₪', midX, pctBaselineY - 15);
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
  if (filters.product) qs.set('productCode', filters.product);
  if (filters.periodMonths && filters.periodMonths.length) qs.set('periodMonths', filters.periodMonths.join(','));
  if (filters.compareMonths && filters.compareMonths.length) qs.set('compareMonths', filters.compareMonths.join(','));
  const q = qs.toString();
  const res = await fetch('/api/dashboard-sales-summary' + (q ? '?' + q : ''), { credentials: 'include' });
  if (!res.ok) return;
  const s = await res.json();
  const suffix = (s.customerName ? (' — ' + s.customerName) : '') + (s.productName ? (' — ' + s.productName) : '');
  const baseReportParams = Object.assign({}, s.customerNumber && { customerNumber: s.customerNumber }, s.productCode && { productCode: s.productCode });
  const ct = s.compareTotals;

  if (s.period) {
    document.getElementById('monthlyTrendTitle').textContent = 'השוואת תקופות' + suffix;
    document.getElementById('monthlyTrendSubtitle').textContent =
      'התקופה ' + s.period.label + (s.comparePeriod ? ' לעומת ' + s.comparePeriod.label : '') +
      '. לחצו על עמודה כדי לצפות בשורות המכירה של אותו חודש בדוח המלא. החץ מציין שינוי לעומת אותו חודש אשתקד (לחודשים שהסתיימו בלבד).';
    document.getElementById('salesSummaryTitle').textContent = 'תמונת מכירות — ' + s.period.label + suffix;
    document.getElementById('salesSummarySubtitle').textContent = 'מבוסס על שורות המכירה בתקופה ' + s.period.label + (s.customerNumber ? (' של ' + s.customerName) : '') + '. לחצו על כל פרוסה/עמודה כדי לצפות בשורות הרלוונטיות בדוח המלא.';
  } else {
    const mt = s.monthlyTimeline;
    const fmtKey = (mk) => { const [y, m] = mk.split('-'); return s.monthNames[+m - 1] + ' ' + y; };
    document.getElementById('monthlyTrendTitle').textContent = 'מחזור מכירות חודשי' + suffix;
    document.getElementById('monthlyTrendSubtitle').textContent =
      'נתוני ' + fmtKey(mt.months[0]) + (mt.months.length > 1 ? ' עד ' + fmtKey(mt.months[mt.months.length - 1]) : '') +
      ', ברצף. לחצו על עמודה כדי לצפות בשורות המכירה של אותו חודש בדוח המלא. החץ מציין את שיעור השינוי של התקופה הנוכחית בלבד, לעומת אותו חודש אשתקד.';
    document.getElementById('salesSummaryTitle').textContent = (s.customerNumber ? 'תמונת מכירות — הלקוח הנבחר' : 'תמונת מכירות כוללת');
    document.getElementById('salesSummarySubtitle').textContent = s.customerNumber
      ? ('מבוסס על שורות המכירה של ' + s.customerName + ' בלבד. לחצו על כל פרוסה/עמודה כדי לצפות בשורות הרלוונטיות בדוח המלא.')
      : 'מבוסס על דוח המכירות המלא — כל שורות המכירות בצירוף נתוני הלקוחות והמוצרים. לחצו על כל פרוסה/עמודה כדי לצפות בשורות הרלוונטיות בדוח המלא.';
  }
  document.getElementById('salesSummaryFullReportLink').href = reportUrl(baseReportParams);
  document.getElementById('superTypeTitle').textContent = 'מחזור לפי טיפוס על' + suffix;
  document.getElementById('departmentTitle').textContent = 'מחזור לפי מחלקת מוצר' + suffix;
  document.getElementById('topProductsTitle').textContent = s.customerNumber ? '10 המוצרים המובילים אצל הלקוח' : '5 המוצרים המובילים במחזור';
  document.getElementById('topCustomersTitle').textContent = s.customerNumber ? 'מחזור הלקוח הנבחר' : '5 הלקוחות המובילים במחזור';

  // A single selected month can be expressed as the full report's own year/month
  // filter; a multi-month period has no equivalent there, so the tile link degrades
  // gracefully to customer-only filtering in that case.
  function singleMonthParams(periodInfo) {
    if (!periodInfo || periodInfo.months.length !== 1) return {};
    const [y, m] = periodInfo.months[0].split('-');
    return { year: y, month: String(Number(m)) };
  }
  const curReportParams = Object.assign({}, baseReportParams, singleMonthParams(s.period));
  const compareReportParams = Object.assign({}, baseReportParams, singleMonthParams(s.comparePeriod));

  const kpiTiles = [
    ['blue', 'v-blue', fmtMoneyShort(s.totalRevenue), 'מכירות תקופה נוכחית (ש"ח)', reportUrl(curReportParams)],
    ['green', 'v-green', s.activeProductCount.toLocaleString('he-IL'), 'כמות מוצרים שנמכרו בתקופה נוכחית', reportUrl(curReportParams)]
  ];
  if (ct) {
    kpiTiles.push(
      ['blue', 'v-blue', fmtMoneyShort(ct.totalRevenue), 'מכירות תקופת השוואה (ש"ח)', reportUrl(compareReportParams)],
      ['green', 'v-green', ct.activeProductCount.toLocaleString('he-IL'), 'כמות מוצרים שנמכרו בתקופת השוואה', reportUrl(compareReportParams)]
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
        layout: { padding: { top: 38 } },
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
    // Continuous monthly revenue trend across the whole sales history — one bar per
    // month in sequence, not grouped by calendar month across years. A year-over-year
    // indicator is drawn only above the single most recent fully-completed month (the
    // "current period" when no period filter is active), not above every historical
    // month, so a long multi-year timeline doesn't end up cluttered with arrows.
    const mt = s.monthlyTimeline;
    const n = mt.months.length;
    const labels = mt.months.map((mk) => { const [y, m] = mk.split('-'); return s.monthNames[+m - 1] + ' ' + y; });
    const monthMeta = mt.months.map((mk) => { const [y, m] = mk.split('-'); return { year: +y, month: +m }; });
    const timelineYoyEntries = buildYoyEntries(n,
      (i) => ({ value: mt.data[i], meta: monthMeta[i] }),
      (i) => mt.yoyData[i]
    );
    const currentEntry = timelineYoyEntries.length ? [timelineYoyEntries[timelineYoyEntries.length - 1]] : [];
    upsertChart('monthlyTrendChart', {
      type: 'bar',
      data: { labels, datasets: [{ label: 'מחזור', data: mt.data, backgroundColor: DASH_BLUE, borderRadius: 4 }] },
      plugins: [yoyDrawPlugin(currentEntry, [0])],
      options: {
        responsive: true, maintainAspectRatio: false,
        layout: { padding: { top: 38 } },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { afterLabel: yoyTooltipAfterLabel(currentEntry, 0) } }
        },
        scales: { y: { ticks: { callback: (v) => v.toLocaleString('he-IL') } } },
        onClick: function (evt, elements) {
          if (!elements.length) return;
          const el = elements[0];
          const m = monthMeta[el.index];
          window.location.href = reportUrl(Object.assign({}, baseReportParams, { year: m.year, month: m.month }));
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

  return s;
}

(function () {
  const params = new URLSearchParams(window.location.search);
  loadDashboardSalesSummary({
    customer: params.get('customer') || null,
    periodMonths: (params.get('periodMonths') || '').split(',').filter(Boolean),
    compareMonths: (params.get('compareMonths') || '').split(',').filter(Boolean)
  });
})();
