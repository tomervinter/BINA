// Dependency-free multi-select month/year dropdown. Replaces native <input type=month>
// (whose calendar widget can only pick one month at a time and renders inconsistently
// across browsers) with a checklist grouped by year, so a "period" can be any set of
// months — a contiguous range, or specific months picked by hand.
const MMS_MONTH_NAMES = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

function mmsFormatKey(key) {
  const [y, m] = key.split('-');
  return MMS_MONTH_NAMES[+m - 1] + ' ' + y;
}

function createMonthMultiSelect(containerId, opts) {
  opts = opts || {};
  const container = document.getElementById(containerId);
  if (!container) return null;
  const now = new Date();
  const yearsAhead = opts.yearsAhead != null ? opts.yearsAhead : 0;
  const yearsBack = opts.yearsBack != null ? opts.yearsBack : 3;
  const years = [];
  for (let y = now.getFullYear() + yearsAhead; y >= now.getFullYear() - yearsBack; y--) years.push(y);
  const placeholder = opts.placeholder || 'בחרו חודשים...';

  let selected = new Set(opts.initial || []);
  const onChange = opts.onChange || function () {};

  container.classList.add('mms');
  container.innerHTML =
    '<button type="button" class="mms-toggle"></button>' +
    '<div class="mms-panel" hidden>' +
      years.map((y) => (
        '<div class="mms-year-group">' +
          '<div class="mms-year-label">' + y + '</div>' +
          MMS_MONTH_NAMES.map((name, i) => {
            const key = y + '-' + String(i + 1).padStart(2, '0');
            return '<label class="mms-option"><input type="checkbox" value="' + key + '"' + (selected.has(key) ? ' checked' : '') + '>' + name + '</label>';
          }).join('') +
        '</div>'
      )).join('') +
    '</div>';

  const toggle = container.querySelector('.mms-toggle');
  const panel = container.querySelector('.mms-panel');

  function refreshLabel() {
    if (!selected.size) { toggle.textContent = placeholder; return; }
    const arr = Array.from(selected).sort();
    toggle.textContent = arr.length <= 2 ? arr.map(mmsFormatKey).join(', ') : (arr.length + ' חודשים נבחרו');
  }

  toggle.addEventListener('click', (e) => { e.stopPropagation(); panel.hidden = !panel.hidden; });
  document.addEventListener('click', (e) => { if (!container.contains(e.target)) panel.hidden = true; });
  container.querySelectorAll('input[type=checkbox]').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) selected.add(cb.value); else selected.delete(cb.value);
      refreshLabel();
      onChange(Array.from(selected).sort());
    });
  });

  refreshLabel();

  return {
    getSelected: () => Array.from(selected).sort(),
    setSelected: (arr) => {
      selected = new Set(arr || []);
      container.querySelectorAll('input[type=checkbox]').forEach((cb) => { cb.checked = selected.has(cb.value); });
      refreshLabel();
    }
  };
}
