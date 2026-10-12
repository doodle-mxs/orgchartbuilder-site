// UI wiring: settings panel, live preview with pan/zoom, file loading, exports.
(function () {
  const $ = (id) => document.getElementById(id);
  const STORE = 'orgchartbuilder.settings.v1';
  const COLUMNS_STORE = 'orgchartbuilder.columns.v1';
  const CSV_STORE = 'orgchartbuilder.lastCsv.v1';
  const SAMPLE_LABEL = 'Sample data (sample.csv)';

  const DEFAULTS = {
    idCol: '', managerCol: '', nameCol: '', sortBy: '',
    orientation: 'TB', stack: '2', stackMin: 3, maxDepth: 0, rootId: '',
    cardW: 180, cardH: 60, hGap: 20, vGap: 48, fontSize: 12,
    line1: '', line2: '', line3: '',
    cardStyle: 'tinted', colorBy: '', baseColor: '#2563eb', rounded: true,
    rememberCsv: false,
    skipDrawioWarning: false,
  };
  // Settings that only make sense for one CSV shape; remembered per set of headers.
  const PER_FILE = ['idCol', 'managerCol', 'nameCol', 'sortBy', 'line1', 'line2', 'line3', 'colorBy', 'rootId'];
  const PRESETS = {
    classic: { orientation: 'TB', stack: 'off' },
    compact: { orientation: 'TB', stack: '2', stackMin: 3 },
    lists: { orientation: 'TB', stack: '1', stackMin: 1 },
    sideways: { orientation: 'LR', stack: 'off' },
  };
  const NUMBERS = new Set(['stackMin', 'maxDepth', 'cardW', 'cardH', 'hGap', 'vGap', 'fontSize']);
  // Changing these reshapes the whole chart, so the view is re-fitted afterwards.
  const REFIT = new Set(['orientation', 'rootId', 'maxDepth', 'idCol', 'managerCol', 'nameCol']);

  let s = loadSettings();
  let data = { headers: [], records: [] };
  let sig = ''; // identifies the current CSV's set of headers
  let current = { text: '', label: '', sample: true };
  let tree;
  let layout;
  let styler;
  const view = { k: 1, x: 0, y: 0 };

  function readJSON(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  }

  function loadSettings() {
    const saved = readJSON(STORE, {});
    return Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, saved[k] ?? DEFAULTS[k]]));
  }

  function saveSettings() {
    const global = Object.fromEntries(Object.entries(s).filter(([k]) => !PER_FILE.includes(k)));
    const memo = readJSON(COLUMNS_STORE, {});
    if (sig) memo[sig] = { ...Object.fromEntries(PER_FILE.map((k) => [k, s[k]])), savedAt: Date.now() };
    // Only the 20 most recently used CSV shapes are remembered.
    const recent = Object.entries(memo).sort((a, b) => b[1].savedAt - a[1].savedAt).slice(0, 20);
    try {
      localStorage.setItem(STORE, JSON.stringify(global));
      localStorage.setItem(COLUMNS_STORE, JSON.stringify(Object.fromEntries(recent)));
    } catch { /* storage unavailable */ }
  }

  // Keeps or forgets the loaded CSV in this browser, following the opt-in checkbox.
  function syncStoredCsv() {
    const note = $('rememberNote');
    try {
      if (s.rememberCsv && !current.sample) {
        localStorage.setItem(CSV_STORE, JSON.stringify({ text: current.text, label: current.label }));
      } else {
        localStorage.removeItem(CSV_STORE);
      }
      note.textContent = s.rememberCsv
        ? 'Kept in this browser only, never uploaded. Turn off on shared computers.'
        : 'Off: the data is forgotten when you refresh or close the page.';
      note.classList.remove('error');
    } catch {
      note.textContent = 'Could not remember this CSV: too large for browser storage, or storage is blocked.';
      note.classList.add('error');
    }
  }

  // Guess which columns hold what, based on common header names.
  function detectColumns(headers) {
    const pick = (re, skip = []) => headers.find((h) => re.test(h) && !skip.includes(h)) || '';
    const managerCol = pick(/manager|reports?[\s_-]*to|supervisor|boss|parent|line[\s_-]*lead/i);
    const idCol = pick(/^(id|#|(employee|emp|staff|person|user|worker)[\s_-]*(id|no|nr|number|#))$/i, [managerCol]);
    const nameCol = pick(/^((full|display|employee)[\s_-]*)?name$/i, [managerCol]) || pick(/name/i, [managerCol]);
    const title = pick(/title|role|position|job/i, [managerCol]);
    const dept = pick(/dep(t|artment)?\b|team|division|unit|group|function/i, [managerCol]);
    return {
      idCol, managerCol, nameCol, sortBy: '',
      line1: nameCol || idCol || headers[0] || '', line2: title, line3: '',
      colorBy: dept,
    };
  }

  function loadData(text, label, { sample = false, restored = false } = {}) {
    data = parseCSV(text);
    sig = data.headers.join('\u0001');
    current = { text, label, sample };
    // Seen these exact headers before: restore the column choices. Otherwise auto-detect.
    const saved = readJSON(COLUMNS_STORE, {})[sig];
    Object.assign(s, saved
      ? Object.fromEntries(PER_FILE.map((k) => [k, saved[k] ?? '']))
      : { ...detectColumns(data.headers), rootId: '' });
    fillColumnSelects();
    $('fileInfo').textContent = data.headers.length
      ? `${label}${restored ? ' (remembered)' : ''}: ${data.records.length} rows, ${data.headers.length} columns.`
      : `${label}: no data found.`;
    syncStoredCsv();
    update({ fit: true });
  }

  function fillColumnSelects() {
    for (const sel of document.querySelectorAll('select[data-columns]')) {
      const empty = sel.dataset.columns === 'csv-order' ? 'CSV order' : '(none)';
      sel.innerHTML = `<option value="">${empty}</option>` +
        data.headers.map((h) => `<option value="${escXml(h)}">${escXml(h)}</option>`).join('');
    }
  }

  function update(opts = {}) {
    tree = buildTree(data.records, { id: s.idCol, name: s.nameCol, manager: s.managerCol, sortBy: s.sortBy });
    const focus = s.rootId && tree.byId.get(s.rootId);
    if (!focus) s.rootId = '';
    styler = makeStyler(s, tree.nodes);
    layout = computeLayout(focus ? [focus] : tree.roots, s);

    $('chart').innerHTML = renderSVG(layout, s, styler);
    for (const g of $('chart').querySelectorAll('.card')) {
      const n = tree.byId.get(g.dataset.id);
      if (n && (n.children.length || n.id === s.rootId)) g.classList.add('has-reports');
    }

    fillRootSelect();
    fillLevelSelect();
    renderWarnings();
    renderLegend();
    syncControls();
    $('summary').textContent = focus
      ? `${layout.cards.length} of ${tree.nodes.length} people · branch of ${focus.name}`
      : `${layout.cards.length} people`;
    $('showAll').hidden = !focus;
    saveSettings();
    if (opts.fit) fit(); else applyView();
  }

  function countBelow(n) {
    return n.children.reduce((sum, c) => sum + 1 + countBelow(c), 0);
  }

  function fillRootSelect() {
    const managers = tree.nodes.filter((n) => n.children.length)
      .sort((a, b) => a.name.localeCompare(b.name));
    $('rootSel').innerHTML = '<option value="">Everyone</option>' + managers
      .map((n) => `<option value="${escXml(n.id)}">${escXml(n.name)} (${countBelow(n)} below)</option>`).join('');
  }

  function fillLevelSelect() {
    const depthOf = (n) => 1 + Math.max(0, ...n.children.map(depthOf));
    const max = Math.max(1, ...tree.roots.map(depthOf));
    let html = '<option value="0">All levels</option>';
    for (let i = 1; i < max; i++) html += `<option value="${i}">${i} level${i > 1 ? 's' : ''}</option>`;
    $('levelSel').innerHTML = html;
  }

  function renderWarnings() {
    const w = [...tree.warnings];
    if (!s.managerCol) w.unshift('Pick the manager column to build the hierarchy.');
    $('warnings').innerHTML = w.slice(0, 50).map((t) => `<li>${escXml(t)}</li>`).join('') +
      (w.length > 50 ? `<li>…and ${w.length - 50} more.</li>` : '');
  }

  function renderLegend() {
    $('legend').innerHTML = [...styler.categories]
      .map(([name, color]) => `<li><i style="background:${color}"></i>${escXml(name)}</li>`).join('');
  }

  function syncControls() {
    for (const el of document.querySelectorAll('.panel [data-key]')) {
      const v = s[el.dataset.key];
      if (el.type === 'checkbox') el.checked = !!v;
      else el.value = v;
      const out = el.closest('.range')?.querySelector('output');
      if (out) out.textContent = `${v}px`;
    }
    $('stackSel').disabled = s.orientation !== 'TB';
    $('baseColor').disabled = !!s.colorBy;
    for (const b of document.querySelectorAll('[data-preset]')) {
      const p = PRESETS[b.dataset.preset];
      b.classList.toggle('active', Object.keys(p).every((k) => s[k] === p[k]));
    }
  }

  // ---- Settings panel ----
  document.querySelector('.panel').addEventListener('input', (ev) => {
    const el = ev.target;
    const key = el.dataset.key;
    if (!key) return;
    s[key] = el.type === 'checkbox' ? el.checked : NUMBERS.has(key) ? Number(el.value) : el.value;
    if (key === 'rememberCsv') syncStoredCsv();
    update({ fit: REFIT.has(key) });
  });

  for (const b of document.querySelectorAll('[data-preset]')) {
    b.addEventListener('click', () => {
      Object.assign(s, PRESETS[b.dataset.preset]);
      update({ fit: true });
    });
  }

  $('reset').addEventListener('click', () => {
    s = { ...DEFAULTS, ...detectColumns(data.headers), rememberCsv: s.rememberCsv };
    update({ fit: true });
  });

  $('showAll').addEventListener('click', () => { s.rootId = ''; update({ fit: true }); });

  // Click a manager to focus their branch; click the focused person to go up a level.
  function onCardClick(id) {
    const n = tree.byId.get(id);
    if (!n) return;
    if (n.id === s.rootId) s.rootId = n.parent ? n.parent.id : '';
    else if (n.children.length) s.rootId = n.id;
    else return;
    update({ fit: true });
  }

  // ---- Pan & zoom ----
  const stage = $('stage');
  const chart = $('chart');

  function applyView() {
    chart.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
    $('zoomLabel').textContent = `${Math.round(view.k * 100)}%`;
  }

  function fit() {
    const r = stage.getBoundingClientRect();
    const pad = 24;
    view.k = Math.max(0.05, Math.min((r.width - 2 * pad) / layout.width, (r.height - 2 * pad) / layout.height, 1.5));
    view.x = (r.width - layout.width * view.k) / 2;
    view.y = Math.max(pad, (r.height - layout.height * view.k) / 2);
    applyView();
  }

  function zoomAt(factor, cx, cy) {
    const k = Math.min(4, Math.max(0.05, view.k * factor));
    view.x = cx - (cx - view.x) * (k / view.k);
    view.y = cy - (cy - view.y) * (k / view.k);
    view.k = k;
    applyView();
  }

  function zoomCenter(factor) {
    const r = stage.getBoundingClientRect();
    zoomAt(factor, r.width / 2, r.height / 2);
  }

  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  let drag = null;
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = { sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y, moved: false, card: e.target.closest('.card') };
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.sx;
    const dy = e.clientY - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    stage.classList.add('dragging');
    view.x = drag.vx + dx;
    view.y = drag.vy + dy;
    applyView();
  });
  stage.addEventListener('pointerup', () => {
    if (drag && !drag.moved && drag.card) onCardClick(drag.card.dataset.id);
    drag = null;
    stage.classList.remove('dragging');
  });

  $('fit').addEventListener('click', fit);
  $('zoomIn').addEventListener('click', () => zoomCenter(1.25));
  $('zoomOut').addEventListener('click', () => zoomCenter(0.8));

  // ---- Loading files ----
  function readFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => loadData(reader.result, file.name);
    reader.readAsText(file);
  }

  $('file').addEventListener('change', (e) => {
    readFile(e.target.files[0]);
    e.target.value = '';
  });

  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; document.body.classList.add('drag-over'); });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('drag-over'); } });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('drag-over');
    readFile(e.dataTransfer.files[0]);
  });

  // ---- Export ----
  function download(name, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  $('dlDrawio').addEventListener('click', () => {
    download('org-chart.drawio', new Blob([toDrawio(layout, s, styler)], { type: 'application/xml' }));
  });

  $('dlSvg').addEventListener('click', () => {
    download('org-chart.svg', new Blob([renderSVG(layout, s, styler)], { type: 'image/svg+xml' }));
  });

  $('dlPng').addEventListener('click', () => {
    const svg = renderSVG(layout, s, styler);
    // 2x for crisp output, capped to stay within browser canvas limits.
    const scale = Math.min(2, 16000 / layout.width, 16000 / layout.height, Math.sqrt(1.2e8 / (layout.width * layout.height)));
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(layout.width * scale);
      canvas.height = Math.round(layout.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((blob) => download('org-chart.png', blob), 'image/png');
    };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });

  // The link carries the whole chart, so it ends up in browser history: warn first.
  const drawioDialog = $('drawioDialog');
  $('openDrawio').addEventListener('click', () => {
    if (s.skipDrawioWarning) openInDrawio();
    else drawioDialog.showModal();
  });
  $('drawioCancel').addEventListener('click', () => drawioDialog.close());
  $('drawioDownload').addEventListener('click', () => {
    drawioDialog.close();
    $('dlDrawio').click();
  });
  $('drawioOpen').addEventListener('click', () => {
    if ($('drawioDontAsk').checked) {
      s.skipDrawioWarning = true;
      saveSettings();
    }
    drawioDialog.close();
    openInDrawio();
  });

  async function openInDrawio() {
    const tab = window.open('', '_blank'); // open synchronously so popup blockers allow it
    const url = await drawioUrl(toDrawio(layout, s, styler));
    if (url.length > 1_500_000) {
      tab?.close();
      alert('This chart is too large to open via link. Use the .drawio download and open that file in draw.io instead.');
      return;
    }
    if (tab) tab.location.href = url;
    else window.location.href = url;
  }

  $('loadSample').addEventListener('click', () => loadData(SAMPLE_CSV, SAMPLE_LABEL, { sample: true }));

  const stored = s.rememberCsv && readJSON(CSV_STORE, null);
  if (stored?.text) loadData(stored.text, stored.label, { restored: true });
  else loadData(SAMPLE_CSV, SAMPLE_LABEL, { sample: true });
})();
