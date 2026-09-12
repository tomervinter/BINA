// Two dashboard charts, one per newly-defined insight rule (policy: every rule gets a
// dashboard chart or summary metric) — counts of the currently generated insights by
// sub-type. Computed client-side from the same /api/insights the executive summary and
// insight list already use, no extra endpoint needed. Bars link into the insights log
// pre-filtered to that type.
const SALES_PATTERN_TYPES = ['monthlyRevenueShift', 'quarterlyRevenueShift', 'cumulativeYoyShift', 'seasonalGrowth', 'seasonalDecline', 'holidayMomentumShift'];
const PURCHASE_PATTERN_TYPES = ['productQuantityShift', 'productFrequencyYoyShift', 'purchaseIrregularity', 'newProductAdopted', 'productConcentrationRisk'];

async function initDashboardPatternInsights() {
  const res = await fetch('/api/insights', { credentials: 'include' });
  if (!res.ok) return;
  const insights = await res.json();

  function countsFor(types) {
    return types.map((t) => ({ type: t, label: (TYPE_META[t] || {}).label || t, count: insights.filter((i) => i.type === t).length }));
  }

  function renderChart(canvasId, types, color) {
    const data = countsFor(types);
    new Chart(document.getElementById(canvasId), {
      type: 'bar',
      data: { labels: data.map((d) => d.label), datasets: [{ label: 'תובנות', data: data.map((d) => d.count), backgroundColor: color, borderRadius: 6 }] },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: { x: { ticks: { stepSize: 1, precision: 0 } } },
        onClick: (evt, elements) => {
          if (!elements.length) return;
          const d = data[elements[0].index];
          window.location.href = 'insights.html?type=' + encodeURIComponent(d.label);
        },
        onHover: (evt, elements) => { evt.native.target.style.cursor = elements.length ? 'pointer' : 'default'; }
      }
    });
  }

  renderChart('salesPatternChart', SALES_PATTERN_TYPES, '#3D5CF5');
  renderChart('purchasePatternChart', PURCHASE_PATTERN_TYPES, '#2FA88C');
}

initDashboardPatternInsights();
