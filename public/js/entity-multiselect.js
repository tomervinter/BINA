// Dependency-free multi-select dropdown for an arbitrary list of {value, label}
// options (customers, products, or a short list of segment values) — the same
// toggle+panel interaction as month-multiselect.js (see .mms* styles), plus a
// search box to filter long option lists (customers/products can run into the
// hundreds; segment dropdowns skip the search box via opts.searchable:false).
function createEntityMultiSelect(containerId, opts) {
  opts = opts || {};
  const container = document.getElementById(containerId);
  if (!container) return null;
  const options = opts.options || []; // [{value, label}]
  const placeholder = opts.placeholder || 'הכל';
  const searchable = opts.searchable !== false;
  let selected = new Set(opts.initial || []);
  const onChange = opts.onChange || function () {};

  // Optional one-click presets shown above the checklist (e.g. "Q1", "מצטבר") — each
  // toggles its whole value set into/out of the current selection (so e.g. Q1 and Q2
  // can both be active together, covering Jan-Jun), rather than replacing it.
  const quickActions = opts.quickActions || [];

  container.classList.add('mms');
  container.innerHTML =
    '<button type="button" class="mms-toggle"></button>' +
    '<div class="mms-panel" hidden>' +
      (searchable ? '<input type="text" class="ems-search" placeholder="חיפוש...">' : '') +
      (quickActions.length ? '<div class="ems-quick-actions">' + quickActions.map((qa, i) => '<button type="button" class="ems-quick-action" data-qa="' + i + '">' + Layout.escapeHtml(qa.label) + '</button>').join('') + '</div>' : '') +
      '<div class="ems-options"></div>' +
    '</div>';

  const toggle = container.querySelector('.mms-toggle');
  const panel = container.querySelector('.mms-panel');
  const search = container.querySelector('.ems-search');
  const optsWrap = container.querySelector('.ems-options');
  const byValue = {};
  options.forEach((o) => { byValue[o.value] = o.label; });

  function refreshLabel() {
    toggle.classList.toggle('mms-toggle-active', !!selected.size);
    if (!selected.size) { toggle.textContent = placeholder; return; }
    if (selected.size === 1) {
      const v = Array.from(selected)[0];
      toggle.textContent = byValue[v] != null ? byValue[v] : v;
      return;
    }
    toggle.textContent = selected.size + ' נבחרו';
  }

  function refreshQuickActions() {
    container.querySelectorAll('.ems-quick-action').forEach((btn) => {
      const qa = quickActions[+btn.getAttribute('data-qa')];
      const fullySelected = !!qa && qa.values.every((v) => selected.has(v));
      btn.classList.toggle('active', fullySelected);
    });
  }

  function renderOptions(filterText) {
    const f = (filterText || '').trim().toLowerCase();
    const filtered = f ? options.filter((o) => o.label.toLowerCase().includes(f)) : options;
    optsWrap.innerHTML = filtered.length
      ? filtered.map((o) => '<label class="mms-option"><input type="checkbox" value="' + Layout.escapeHtml(o.value) + '"' + (selected.has(o.value) ? ' checked' : '') + '><span class="ems-opt-label">' + Layout.escapeHtml(o.label) + '</span></label>').join('')
      : '<div class="ems-empty">אין תוצאות</div>';
    optsWrap.querySelectorAll('input[type=checkbox]').forEach((cb) => {
      cb.addEventListener('change', () => {
        if (cb.checked) selected.add(cb.value); else selected.delete(cb.value);
        refreshLabel();
        refreshQuickActions();
        onChange(Array.from(selected));
      });
    });
    refreshQuickActions();
  }

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    panel.hidden = !panel.hidden;
    if (!panel.hidden) { renderOptions(search ? search.value : ''); if (search) search.focus(); }
  });
  document.addEventListener('click', (e) => { if (!container.contains(e.target)) panel.hidden = true; });
  if (search) search.addEventListener('input', () => renderOptions(search.value));
  container.querySelectorAll('.ems-quick-action').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const qa = quickActions[+btn.getAttribute('data-qa')];
      if (!qa) return;
      const fullySelected = qa.values.every((v) => selected.has(v));
      if (fullySelected) qa.values.forEach((v) => selected.delete(v));
      else qa.values.forEach((v) => selected.add(v));
      renderOptions(search ? search.value : '');
      refreshLabel();
      onChange(Array.from(selected));
    });
  });

  renderOptions('');
  refreshLabel();

  return {
    getSelected: () => Array.from(selected),
    setSelected: (arr) => {
      selected = new Set(arr || []);
      renderOptions(search ? search.value : '');
      refreshLabel();
    },
    setOptions: (newOptions) => {
      options.length = 0;
      Array.prototype.push.apply(options, newOptions);
      Object.keys(byValue).forEach((k) => delete byValue[k]);
      options.forEach((o) => { byValue[o.value] = o.label; });
      renderOptions(search ? search.value : '');
      refreshLabel();
    }
  };
}
