// Shared "type the word to confirm" modal for destructive actions (delete-all).
// A plain confirm() is too easy to click through by habit — this forces the user
// to type the exact word before the destructive button becomes clickable.
function confirmDangerousDelete(message, onConfirm) {
  const requiredWord = 'מחיקה';
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML =
    '<div class="modal-box">' +
    '<div class="modal-title">אישור מחיקה</div>' +
    '<div class="modal-body">' + Layout.escapeHtml(message) + '<br>כדי לאשר, הקלידו את המילה <b>' + requiredWord + '</b> בתיבה למטה:</div>' +
    '<input type="text" class="modal-confirm-input" autocomplete="off">' +
    '<div class="modal-actions">' +
    '<button type="button" class="btn btn-ghost js-modalCancel">ביטול</button>' +
    '<button type="button" class="btn btn-danger js-modalConfirm" disabled>מחיקה סופית</button>' +
    '</div>' +
    '</div>';
  document.body.appendChild(overlay);

  const input = overlay.querySelector('.modal-confirm-input');
  const confirmBtn = overlay.querySelector('.js-modalConfirm');
  function close() { overlay.remove(); }

  input.addEventListener('input', () => { confirmBtn.disabled = input.value.trim() !== requiredWord; });
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !confirmBtn.disabled) confirmBtn.click(); });
  overlay.querySelector('.js-modalCancel').addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  confirmBtn.addEventListener('click', () => { close(); onConfirm(); });

  input.focus();
}
