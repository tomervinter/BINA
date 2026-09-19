// Dropzone + "pick file" + "download sample template" upload control, matching the
// Artifact's upload-row exactly. Selecting or dropping a file uploads it immediately.
function initUploadWidget(container, opts) {
  container.innerHTML =
    '<div class="upload-row">' +
    '<div class="dropzone js-dropzone">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V4"></path><path d="M8 8l4-4 4 4"></path><path d="M4.5 15v3.3a1.7 1.7 0 0 0 1.7 1.7h11.6a1.7 1.7 0 0 0 1.7-1.7V15"></path></svg>' +
    '<span>גררו לכאן קובץ אקסל, או</span></div>' +
    '<input type="file" class="js-fileInput" accept=".xlsx,.xls,.csv" hidden>' +
    '<button class="btn btn-primary js-pickFileBtn" type="button">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 8.5v10a1.7 1.7 0 0 0 1.7 1.7h11.6a1.7 1.7 0 0 0 1.7-1.7v-8.4a1.7 1.7 0 0 0-1.7-1.7H12l-2-2.4H6.2a1.7 1.7 0 0 0-1.7 1.7Z"></path></svg>' +
    'בחירת קובץ</button>' +
    '<button class="btn btn-ghost js-downloadTemplateBtn" type="button">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11"></path><path d="M8 12l4 4 4-4"></path><path d="M4.5 19.5h15"></path></svg>' +
    'הורדת תבנית לדוגמה</button>' +
    '<div class="upload-status js-uploadStatus"></div>' +
    '</div>';

  const dropzone = container.querySelector('.js-dropzone');
  const fileInput = container.querySelector('.js-fileInput');
  const statusLine = container.querySelector('.js-uploadStatus');

  function setStatus(text, color) {
    statusLine.textContent = text;
    statusLine.style.color = color;
    statusLine.style.display = text ? 'block' : 'none';
  }

  // Uploading returns a jobId as soon as the file is parsed — the actual database
  // write runs in the background (see src/lib/uploadJobs.js) so a large file's slow
  // bulk insert never has to finish inside this one request/response, which is what
  // used to time out (as an opaque network error) for real-world multi-thousand-row
  // sales exports. Poll for completion instead.
  const POLL_INTERVAL_MS = 1500;
  const MAX_POLL_ATTEMPTS = 400; // ~10 minutes, matching the server's own job timeout

  async function uploadFile(file) {
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    setStatus('טוען...', 'var(--text-muted)');
    let jobId;
    try {
      const res = await fetch(opts.apiBase + '/upload', { method: 'POST', credentials: 'include', body: form });
      let result;
      try {
        result = await res.json();
      } catch (parseErr) {
        // A response with no valid JSON body — most often an empty 502/504 from
        // the hosting platform's own proxy — means the request never made it back
        // to our own error handling at all. Almost always the upload itself simply
        // took too long (a very large file over a slow connection), not a bug in
        // the app, so the message points at that instead of a bare "network error".
        setStatus('השרת לא הגיב בזמן — ייתכן שהקובץ גדול מדי או שהחיבור לאינטרנט איטי. נסו שוב, או פנו לתמיכה אם זה חוזר על עצמו.', 'var(--red)');
        return;
      }
      if (!res.ok) { setStatus(result.error || 'שגיאה בהעלאה', 'var(--red)'); return; }
      jobId = result.jobId;
    } catch (err) {
      setStatus('שגיאת רשת — בדקו את החיבור לאינטרנט ונסו שוב', 'var(--red)');
      return;
    }
    setStatus('מעבד את הקובץ...', 'var(--text-muted)');
    await pollJobStatus(jobId);
  }

  async function pollJobStatus(jobId) {
    for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      let data;
      try {
        const res = await fetch('/api/upload-status/' + jobId, { credentials: 'include' });
        data = await res.json();
        if (!res.ok) { setStatus(data.error || 'שגיאה בעיבוד הקובץ', 'var(--red)'); return; }
      } catch (err) {
        setStatus('שגיאת רשת', 'var(--red)');
        return;
      }
      if (data.status === 'done') {
        setStatus('✓ נטענו ' + data.count.toLocaleString('he-IL') + ' רשומות', 'var(--green)');
        if (opts.onUploaded) opts.onUploaded();
        return;
      }
      if (data.status === 'error') {
        setStatus(data.error || 'שגיאה בעיבוד הקובץ', 'var(--red)');
        return;
      }
    }
    setStatus('העיבוד נמשך זמן רב מהצפוי — רעננו את העמוד בעוד כמה דקות', 'var(--red)');
  }

  container.querySelector('.js-pickFileBtn').addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) uploadFile(fileInput.files[0]); });

  ['dragenter', 'dragover'].forEach((evt) => dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.add('drag-over'); }));
  ['dragleave', 'drop'].forEach((evt) => dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.remove('drag-over'); }));
  dropzone.addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) uploadFile(e.dataTransfer.files[0]); });

  container.querySelector('.js-downloadTemplateBtn').addEventListener('click', () => {
    window.location.href = '/api/templates/' + opts.templateEntity;
  });
}
