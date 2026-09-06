// Shared per-user, per-table column ordering: drag a <th> to reorder columns, persisted
// server-side so it follows the user across sessions/devices. A user with no saved order
// falls back to the organization admin's saved order for that table; "reset" clears the
// user's override and falls back to that same admin default (see src/routes/columnOrder.js).
async function loadColumnOrder(tableKey) {
  if (!tableKey) return null;
  try {
    const res = await fetch('/api/column-order/' + encodeURIComponent(tableKey), { credentials: 'include' });
    if (!res.ok) return null;
    return (await res.json()).order;
  } catch (err) { return null; }
}

function applyColumnOrder(columns, order) {
  if (!order || !order.length) return columns.slice();
  const byKey = {};
  columns.forEach((c) => { byKey[c.key] = c; });
  const ordered = order.map((k) => byKey[k]).filter(Boolean);
  const seen = new Set(ordered.map((c) => c.key));
  columns.forEach((c) => { if (!seen.has(c.key)) ordered.push(c); });
  return ordered;
}

function saveColumnOrder(tableKey, columns) {
  if (!tableKey) return;
  fetch('/api/column-order/' + encodeURIComponent(tableKey), {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
    body: JSON.stringify({ order: columns.map((c) => c.key) })
  }).catch(() => {});
}

function resetColumnOrder(tableKey) {
  if (!tableKey) return Promise.resolve();
  return fetch('/api/column-order/' + encodeURIComponent(tableKey), { method: 'DELETE', credentials: 'include' }).catch(() => {});
}

// Binds HTML5 drag-and-drop to the <th> elements of a header row, in the same order as
// `columns`. Calls onReorder(newColumns) once a drag completes; does not re-render itself.
function wireColumnDragReorder(headRowEl, columns, onReorder) {
  if (!headRowEl) return;
  let dragFrom = null;
  Array.from(headRowEl.children).forEach((th, idx) => {
    th.setAttribute('draggable', 'true');
    th.classList.add('th-draggable');
    th.addEventListener('dragstart', (e) => {
      dragFrom = idx;
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      th.classList.add('th-dragging');
    });
    th.addEventListener('dragend', () => th.classList.remove('th-dragging'));
    th.addEventListener('dragover', (e) => { e.preventDefault(); th.classList.add('th-drag-over'); });
    th.addEventListener('dragleave', () => th.classList.remove('th-drag-over'));
    th.addEventListener('drop', (e) => {
      e.preventDefault();
      th.classList.remove('th-drag-over');
      if (dragFrom === null || dragFrom === idx) return;
      const newCols = columns.slice();
      const [moved] = newCols.splice(dragFrom, 1);
      newCols.splice(idx, 0, moved);
      dragFrom = null;
      onReorder(newCols);
    });
  });
}
