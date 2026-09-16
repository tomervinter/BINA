// Hidden once all five of the dashboard's independent init flows (layout/
// greeting via app.js, the filter table + KPIs/charts via dashboard-filters.js,
// the insights columns via dashboard-top-insights.js, the lapsed-customers panel
// via dashboard-lapsed-customers.js, the declining-customers panel via
// dashboard-declining-customers.js) have each rendered their first real content
// — rather than on a fixed timer or window.onload, which would either flash away
// too early (before the data's actually in) or leave a needless extra wait once
// it really is.
window.__dashReadyCount = 0;
window.dashMarkReady = function () {
  window.__dashReadyCount++;
  if (window.__dashReadyCount >= 5) {
    var overlay = document.getElementById('dashLoadingOverlay');
    if (overlay) {
      overlay.classList.add('page-loading-hide');
      setTimeout(function () { overlay.remove(); }, 300);
    }
  }
};

// Shared accordion coordinator for the dashboard's three side-panels (see
// .dash-panel-region in app.css). Each panel's own JS module (dashboard-
// filters.js, dashboard-lapsed-customers.js, dashboard-declining-
// customers.js) calls this once with its own button/box id pair instead of
// wiring its own click handler directly — centralizes the "opening one
// closes the others" rule in one place rather than duplicating it three
// times. Clicking the already-open panel's button closes it (back to the
// empty state) rather than being stuck always-one-open.
window.__dashPanels = [];
window.dashRegisterPanelToggle = function (btnId, boxId) {
  window.__dashPanels.push({ btnId: btnId, boxId: boxId });
  var btn = document.getElementById(btnId);
  var box = document.getElementById(boxId);
  if (!btn || !box) return;
  btn.addEventListener('click', function () {
    var wasOpen = box.style.display !== 'none';
    window.__dashPanels.forEach(function (p) {
      var b = document.getElementById(p.boxId), bt = document.getElementById(p.btnId);
      var shouldOpen = !wasOpen && p.boxId === boxId;
      if (b) b.style.display = shouldOpen ? '' : 'none';
      if (bt) { bt.setAttribute('aria-expanded', String(shouldOpen)); bt.classList.toggle('active', shouldOpen); }
    });
    var anyOpen = window.__dashPanels.some(function (p) { return document.getElementById(p.boxId).style.display !== 'none'; });
    var content = document.getElementById('dashPanelContent');
    if (content) content.classList.toggle('dash-panel-content-open', anyOpen);
    var region = document.querySelector('.dash-panel-region');
    if (region) region.classList.toggle('dash-panel-region-open', anyOpen);
  });
};
