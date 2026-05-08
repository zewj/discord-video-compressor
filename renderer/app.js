const TIERS = {
  free:   { limitMb: 10,  safetyMb: 0.5, audioKbps: 64  },
  basic:  { limitMb: 50,  safetyMb: 1.0, audioKbps: 96  },
  boost:  { limitMb: 100, safetyMb: 1.5, audioKbps: 128 },
  nitro:  { limitMb: 500, safetyMb: 5.0, audioKbps: 128 },
  custom: { limitMb: null, safetyMb: 0.5, audioKbps: 96 },
};

const CODEC_LABELS = {
  libx264:      'CPU H.264 (libx264)',
  libx265:      'CPU HEVC / H.265 (libx265)',
  h264_nvenc:   'NVIDIA NVENC H.264',
  hevc_nvenc:   'NVIDIA NVENC HEVC',
  av1_nvenc:    'NVIDIA NVENC AV1 (RTX 40+)',
  h264_amf:     'AMD AMF H.264',
  hevc_amf:     'AMD AMF HEVC',
  av1_amf:      'AMD AMF AV1 (RDNA 3+)',
  h264_qsv:     'Intel QuickSync H.264',
  hevc_qsv:     'Intel QuickSync HEVC',
  av1_qsv:      'Intel QuickSync AV1 (Arc)',
  h264_vaapi:   'Linux VAAPI H.264',
  hevc_vaapi:   'Linux VAAPI HEVC',
  libsvtav1:    'CPU AV1 (SVT-AV1)',
  'libaom-av1': 'CPU AV1 (libaom — slow)',
  'libvpx-vp9': 'CPU VP9 (libvpx) — WebM',
};
const CODEC_PRIORITY = [
  'h264_nvenc', 'h264_qsv', 'h264_amf', 'h264_vaapi',
  'libx264',
  'hevc_nvenc', 'hevc_qsv', 'hevc_amf', 'hevc_vaapi',
  'libx265',
  'av1_nvenc', 'av1_qsv', 'av1_amf',
  'libsvtav1', 'libaom-av1',
  'libvpx-vp9',
];

const CPU_CODECS = ['libx264','libx265','libsvtav1','libaom-av1','libvpx-vp9'];
function isCpuCodec(c) { return CPU_CODECS.includes(c); }
function containerFor(c) { return c === 'libvpx-vp9' ? 'webm' : 'mp4'; }

const els = {
  pickInput: document.getElementById('pick-input'),
  clearQueue: document.getElementById('clear-queue'),
  queueList: document.getElementById('queue-list'),
  queueCount: document.getElementById('queue-count'),
  emptyHint: document.getElementById('empty-hint'),

  customMb: document.getElementById('custom-mb'),
  customMbSlider: document.getElementById('custom-mb-slider'),
  customMbRow: document.getElementById('custom-mb-row'),
  customTierDisplay: document.getElementById('custom-tier-display'),

  startBtn: document.getElementById('start-btn'),
  cancelBtn: document.getElementById('cancel-btn'),
  exportLogBtn: document.getElementById('export-log-btn'),
  progressFill: document.getElementById('progress-fill'),
  progress: document.querySelector('.progress'),
  phase: document.getElementById('phase'),
  timeInfo: document.getElementById('time-info'),
  toasts: document.getElementById('toasts'),
  versionTag: document.getElementById('version-tag'),

  codecSelect: document.getElementById('codec-select'),
  codecHint: document.getElementById('codec-hint'),
  modeHint: document.getElementById('mode-hint'),
  trimStart: document.getElementById('trim-start'),
  trimEnd: document.getElementById('trim-end'),
  trimClear: document.getElementById('trim-clear'),
  trimHint: document.getElementById('trim-hint'),
  muteAudio: document.getElementById('mute-audio'),
  burnSubs: document.getElementById('burn-subs'),
  subsHint: document.getElementById('subs-hint'),
  crfRow: document.getElementById('crf-row'),
  crfSlider: document.getElementById('crf-slider'),
  crfValue: document.getElementById('crf-value'),

  trimPreview: document.getElementById('trim-preview'),
  trimVideo: document.getElementById('trim-video'),
  trimPlay: document.getElementById('trim-play'),
  trimPlayIcon: document.getElementById('trim-play-icon'),
  trimCurrentTime: document.getElementById('trim-currenttime'),
  trimTrack: document.getElementById('trim-track'),
  trimRange: document.getElementById('trim-range'),
  trimPlayhead: document.getElementById('trim-playhead'),
  trimHandleStart: document.getElementById('trim-handle-start'),
  trimHandleEnd: document.getElementById('trim-handle-end'),

  dropOverlay: document.getElementById('drop-overlay'),
};

// ---------- Tabs ----------
const TAB_KEY = 'dvc.tab';
const tabButtons = document.querySelectorAll('.tab');
const tabPanels = document.querySelectorAll('.tab-panel');
const tabIndicator = document.querySelector('.tab-indicator');
let activeTabName = 'compress';

function moveIndicatorTo(btn) {
  if (!btn || !tabIndicator) return;
  tabIndicator.style.transform = `translateX(${btn.offsetLeft}px)`;
  tabIndicator.style.width = `${btn.offsetWidth}px`;
}

function activateTab(name) {
  let activeBtn = null;
  tabButtons.forEach(b => {
    const on = b.dataset.tab === name;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', on ? 'true' : 'false');
    if (on) activeBtn = b;
  });
  tabPanels.forEach(p => {
    const on = p.dataset.tab === name;
    p.hidden = !on;
    p.classList.toggle('active', on);
  });
  if (activeBtn) requestAnimationFrame(() => moveIndicatorTo(activeBtn));
  activeTabName = name;
  // Pause stats sampling unless the System tab is in view.
  if (window.api && window.api.setStatsEnabled) {
    window.api.setStatsEnabled(name === 'system');
  }
  try { localStorage.setItem(TAB_KEY, name); } catch (_) {}
}

tabButtons.forEach(b => b.addEventListener('click', () => activateTab(b.dataset.tab)));
window.addEventListener('resize', () => moveIndicatorTo(document.querySelector('.tab.active')));
const initialTab = (() => {
  try { return localStorage.getItem(TAB_KEY) || 'compress'; }
  catch { return 'compress'; }
})();
requestAnimationFrame(() => activateTab(initialTab));

// ---------- Theme handling ----------
const THEME_KEY = 'dvc.theme';
const themeButtons = document.querySelectorAll('.theme-btn');
let osIsDark = true;

function effectiveTheme(name) {
  return name === 'auto' ? (osIsDark ? 'dark' : 'light') : name;
}
function applyTheme(name) {
  document.documentElement.dataset.theme = effectiveTheme(name);
  document.documentElement.dataset.themeChoice = name;
  themeButtons.forEach(b => b.classList.toggle('active', b.dataset.theme === name));
  try { localStorage.setItem(THEME_KEY, name); } catch (_) {}
}
themeButtons.forEach(b => b.addEventListener('click', () => applyTheme(b.dataset.theme)));
applyTheme(localStorage.getItem(THEME_KEY) || 'midnight');

window.api.onSystemTheme(({ isDark }) => {
  osIsDark = isDark;
  if (document.documentElement.dataset.themeChoice === 'auto') applyTheme('auto');
});

// ---------- Tier ----------
function getTier() {
  return document.querySelector('input[name="tier"]:checked').value;
}
function resolveTargetMb() {
  const tier = getTier();
  const cfg = TIERS[tier];
  let limit = cfg.limitMb;
  if (limit === null) {
    limit = parseFloat(els.customMb.value);
    if (!Number.isFinite(limit) || limit <= 0) {
      toast('error', 'Bad value', 'Custom size must be a positive number.');
      return null;
    }
  }
  return Math.max(0.5, limit - cfg.safetyMb);
}

// ---------- Toasts ----------
function toast(kind, title, body, action) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  const t = document.createElement('div');
  t.className = 'toast-title'; t.textContent = title;
  const b = document.createElement('div');
  b.textContent = body || '';
  el.appendChild(t); el.appendChild(b);
  if (action) {
    const a = document.createElement('span');
    a.className = 'toast-action';
    a.textContent = action.label;
    a.addEventListener('click', action.onClick);
    el.appendChild(a);
  }
  els.toasts.appendChild(el);
  const ttl = kind === 'error' ? 6000 : 4500;
  setTimeout(() => {
    el.classList.add('fade-out');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, ttl);
}

// ===========================================================================
// QUEUE
// ===========================================================================

let queue = [];           // [{ id, input, output, status, progress, sizeMb?, error?, info? }]
let nextId = 1;
let runningId = null;     // id of the currently-encoding item, or null
let queueCancelled = false;

function basename(p) {
  const slash = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
  return slash >= 0 ? p.slice(slash + 1) : p;
}
function stem(p) {
  const dot = p.lastIndexOf('.');
  return dot >= 0 ? p.slice(0, dot) : p;
}

async function defaultOutputFor(inputPath, codec) {
  const ext = '.' + containerFor(codec || els.codecSelect.value || 'libx264');
  const desired = stem(inputPath) + '_discord' + ext;
  // resolveAvailable bumps "(1)", "(2)" etc. if there's a collision.
  return await window.api.resolveAvailable(desired);
}

async function enqueue(paths) {
  for (const p of paths) {
    const item = {
      id: nextId++,
      input: p,
      output: await defaultOutputFor(p),
      status: 'queued',
      progress: 0,
    };
    queue.push(item);
    // Fire off a probe in the background so we know duration/size before
    // the user even hits Compress.
    window.api.probeMedia(p).then(info => {
      if (info && !info.error) {
        item.info = info;
        renderQueue();
        // The first item's metadata seeds the trim preview.
        if (queue[0] && queue[0].id === item.id) loadTrimPreview(item);
      }
    });
  }
  renderQueue();
}

function removeQueueItem(id) {
  if (id === runningId) return; // can't remove the running one; cancel instead
  queue = queue.filter(q => q.id !== id);
  renderQueue();
}

function clearQueue() {
  if (runningId !== null) return;
  queue = [];
  renderQueue();
  unloadTrimPreview();
}

function renderQueue() {
  els.queueList.innerHTML = '';
  els.queueList.hidden = queue.length === 0;
  els.emptyHint.hidden = queue.length > 0;
  els.clearQueue.disabled = queue.length === 0 || runningId !== null;
  els.queueCount.hidden = queue.length === 0;
  els.queueCount.textContent = String(queue.length);

  // Update the start button label.
  const queued = queue.filter(q => q.status === 'queued').length;
  if (queued > 1) {
    document.querySelector('#start-btn .btn-label').textContent = `Compress queue (${queued})`;
  } else {
    document.querySelector('#start-btn .btn-label').textContent = 'Compress';
  }

  for (const item of queue) {
    const li = document.createElement('li');
    li.className = 'queue-item';
    if (item.status === 'encoding') li.classList.add('is-active');
    if (item.status === 'done')     li.classList.add('is-done');
    if (item.status === 'failed')   li.classList.add('is-failed');

    const icon = document.createElement('div');
    icon.className = 'q-icon';
    icon.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';

    const name = document.createElement('div');
    name.className = 'q-name';
    name.textContent = basename(item.input);
    name.title = item.input;

    const status = document.createElement('div');
    status.className = 'q-status';
    if (item.status === 'queued')   status.textContent = item.info ? `${fmtDuration(item.info.duration)} · ${(item.info.bytes / 1024 / 1024).toFixed(1)} MB` : 'queued';
    if (item.status === 'encoding') status.textContent = `encoding ${item.progress.toFixed(0)}%`;
    if (item.status === 'done')     status.textContent = `✓ ${item.sizeMb ? item.sizeMb.toFixed(2) + ' MB' : 'done'}`;
    if (item.status === 'failed')   status.textContent = `✗ ${item.error || 'failed'}`;

    const actions = document.createElement('div');
    actions.className = 'q-actions';

    if (item.status === 'done') {
      const showBtn = document.createElement('button');
      showBtn.textContent = 'Folder';
      showBtn.addEventListener('click', () => window.api.revealInFolder(item.output));
      actions.appendChild(showBtn);
      const copyBtn = document.createElement('button');
      copyBtn.textContent = 'Copy';
      copyBtn.addEventListener('click', () => copyOutputToClipboard(item.output));
      actions.appendChild(copyBtn);
    }
    if (item.status !== 'encoding') {
      const removeBtn = document.createElement('button');
      removeBtn.textContent = '✕';
      removeBtn.addEventListener('click', () => removeQueueItem(item.id));
      actions.appendChild(removeBtn);
    }

    li.appendChild(icon);
    li.appendChild(name);
    li.appendChild(status);
    li.appendChild(actions);

    if (item.status === 'encoding') {
      const bar = document.createElement('div');
      bar.className = 'q-progress';
      const fill = document.createElement('div');
      fill.className = 'q-progress-fill';
      fill.style.width = `${item.progress}%`;
      bar.appendChild(fill);
      li.appendChild(bar);
    }

    els.queueList.appendChild(li);
  }
}

async function copyOutputToClipboard(path) {
  const r = await window.api.copyFile(path);
  if (r && r.ok) {
    if (r.mode === 'file') {
      toast('success', 'Copied to clipboard', 'Paste into Discord with Ctrl+V.');
    } else {
      toast('info', 'Copied path as text', "Couldn't copy file directly — path is on the clipboard instead.");
    }
  } else {
    toast('error', 'Copy failed', (r && r.error) || 'Unknown error.');
  }
}

// ---------- File pickers ----------
els.pickInput.addEventListener('click', async () => {
  const p = await window.api.pickInput();
  if (p) await enqueue([p]);
});
els.clearQueue.addEventListener('click', clearQueue);

// Drag & drop: works for one or many files.
let dragDepth = 0;
function isFileDrag(e) { return Array.from(e.dataTransfer?.types || []).includes('Files'); }
window.addEventListener('dragenter', (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  dragDepth++;
  els.dropOverlay.classList.add('visible');
});
window.addEventListener('dragover',  (e) => { if (isFileDrag(e)) e.preventDefault(); });
window.addEventListener('dragleave', (e) => {
  if (!isFileDrag(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) els.dropOverlay.classList.remove('visible');
});
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  els.dropOverlay.classList.remove('visible');
  const files = Array.from(e.dataTransfer?.files || []);
  if (!files.length) return;
  const paths = files.map(f => window.api.pathForFile(f)).filter(Boolean);
  if (paths.length) await enqueue(paths);
});

// ===========================================================================
// CODEC / MODE / PRESET / CRF / TRIM / SUBTITLES
// ===========================================================================

let mode = 'fast';
let presetLevel = 'balanced';

function populateCodecs(encoders) {
  els.codecSelect.innerHTML = '';
  const ordered = CODEC_PRIORITY.filter(c => encoders.includes(c));
  for (const c of ordered) {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = CODEC_LABELS[c] || c;
    els.codecSelect.appendChild(opt);
  }
  const saved = localStorage.getItem('dvc.codec');
  if (saved && ordered.includes(saved)) els.codecSelect.value = saved;
  updateCodecHint();
  syncModeForCodec();
  syncOutputsForAll();  // re-sync queue items' output extensions
}

els.codecSelect.addEventListener('change', () => {
  localStorage.setItem('dvc.codec', els.codecSelect.value);
  updateCodecHint();
  syncModeForCodec();
  syncOutputsForAll();
});

function updateCodecHint() {
  const c = els.codecSelect.value;
  if (!c) { els.codecHint.textContent = 'No encoders detected.'; return; }
  let hint;
  if (c === 'libx264' || c === 'libx265') {
    hint = 'CPU encoder. Two-pass available; high quality.';
  } else if (c === 'libsvtav1') {
    hint = 'CPU AV1 (SVT-AV1). Modern, efficient. MP4 output.';
  } else if (c === 'libaom-av1') {
    hint = 'CPU AV1 (libaom). Highest quality, very slow. MP4 output.';
  } else if (c === 'libvpx-vp9') {
    hint = 'CPU VP9. Output is .webm — Discord previews vary by client.';
  } else if (c.includes('nvenc')) {
    hint = 'NVIDIA GPU encoder. Much faster; single-pass CBR.';
  } else if (c.includes('qsv')) {
    hint = 'Intel iGPU encoder. Faster than CPU; single-pass.';
  } else if (c.includes('amf')) {
    hint = 'AMD GPU encoder. Faster than CPU; single-pass.';
  } else if (c.includes('vaapi')) {
    hint = 'Linux VAAPI HW encoder. Single-pass; needs /dev/dri/renderD128.';
  } else hint = '';
  els.codecHint.textContent = hint;
}

function syncModeForCodec() {
  const c = els.codecSelect.value;
  const cpu = isCpuCodec(c);
  const twoBtn = document.querySelector('.seg-btn[data-mode="twopass"]');
  if (!twoBtn) return;
  twoBtn.disabled = !cpu;
  twoBtn.title = cpu ? '' : 'Two-pass requires a CPU codec';
  if (!cpu && mode === 'twopass') {
    document.querySelector('.seg-btn[data-mode="fast"]').click();
  }
}

async function syncOutputsForAll() {
  const ext = '.' + containerFor(els.codecSelect.value);
  for (const item of queue) {
    if (item.status !== 'queued') continue;
    const m = item.output.match(/^(.*)(\.[^.\\/]+)$/);
    const base = m ? m[1] : item.output;
    item.output = base + ext;
    item.output = await window.api.resolveAvailable(item.output);
  }
  renderQueue();
}

document.querySelectorAll('.seg-btn[data-mode]').forEach(b => {
  b.addEventListener('click', () => {
    if (b.disabled) return;
    mode = b.dataset.mode;
    document.querySelectorAll('.seg-btn[data-mode]').forEach(x =>
      x.classList.toggle('active', x === b));
    els.crfRow.hidden = mode !== 'crf';
  });
});
document.querySelectorAll('.seg-btn[data-preset]').forEach(b => {
  b.addEventListener('click', () => {
    presetLevel = b.dataset.preset;
    document.querySelectorAll('.seg-btn[data-preset]').forEach(x =>
      x.classList.toggle('active', x === b));
  });
});

// CRF slider value display.
els.crfSlider.addEventListener('input', () => {
  els.crfValue.textContent = els.crfSlider.value;
});

// ---------- Trim ----------
function parseTime(s) {
  s = (s || '').trim();
  if (!s) return null;
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  const parts = s.split(':').map(p => p.trim());
  if (parts.some(p => !/^\d+(\.\d+)?$/.test(p))) return NaN;
  let total = 0;
  for (const p of parts) total = total * 60 + parseFloat(p);
  return total;
}
function fmtDuration(secs) {
  if (!Number.isFinite(secs)) return '--';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}
function updateTrimHint() {
  const total = parseFloat(document.body.dataset.srcDuration || '0');
  const start = parseTime(els.trimStart.value) || 0;
  let end = parseTime(els.trimEnd.value);
  if (!Number.isFinite(end) || end == null) end = total;
  if (!total) { els.trimHint.textContent = 'Pick a video to enable trim.'; return; }
  if (Number.isNaN(start) || Number.isNaN(end)) { els.trimHint.textContent = 'Use mm:ss or seconds.'; return; }
  const dur = Math.max(0, end - start);
  if (start === 0 && end === total) {
    els.trimHint.textContent = `Full clip: ${fmtDuration(total)}`;
  } else {
    els.trimHint.textContent = `Trim: ${fmtDuration(dur)} (of ${fmtDuration(total)})`;
  }
  // Mirror to visual handles.
  if (total > 0) {
    setHandlePct('start', Math.max(0, Math.min(1, start / total)));
    setHandlePct('end',   Math.max(0, Math.min(1, end   / total)));
  }
}
els.trimStart.addEventListener('input', updateTrimHint);
els.trimEnd.addEventListener('input', updateTrimHint);
els.trimClear.addEventListener('click', () => {
  els.trimStart.value = '';
  els.trimEnd.value = '';
  updateTrimHint();
});

// ---------- Visual trim (video preview + draggable handles) ----------
let trimDuration = 0;
let trimStartPct = 0;
let trimEndPct = 1;

function loadTrimPreview(item) {
  if (!item || !item.input) return;
  const url = window.api.mediaUrl(item.input);
  els.trimVideo.src = url;
  els.trimPreview.hidden = false;
  if (item.info && item.info.duration) {
    trimDuration = item.info.duration;
    document.body.dataset.srcDuration = String(trimDuration);
    updateTrimHint();
  }
  // Reset trim handles to full clip.
  trimStartPct = 0;
  trimEndPct = 1;
  setHandlePct('start', 0);
  setHandlePct('end', 1);
}
function unloadTrimPreview() {
  els.trimVideo.removeAttribute('src');
  els.trimVideo.load();
  els.trimPreview.hidden = true;
}

els.trimVideo.addEventListener('loadedmetadata', () => {
  // The probe duration is canonical; only fall back to video.duration if probe
  // didn't run for some reason (it almost always does).
  if (!trimDuration && els.trimVideo.duration) {
    trimDuration = els.trimVideo.duration;
    document.body.dataset.srcDuration = String(trimDuration);
    updateTrimHint();
  }
});

els.trimVideo.addEventListener('timeupdate', () => {
  if (!trimDuration) return;
  const pct = els.trimVideo.currentTime / trimDuration;
  els.trimPlayhead.style.left = `${pct * 100}%`;
  els.trimCurrentTime.textContent = fmtDuration(els.trimVideo.currentTime);
  // Loop within the trim range when playing.
  if (els.trimVideo.currentTime >= trimEndPct * trimDuration - 0.05) {
    els.trimVideo.currentTime = trimStartPct * trimDuration;
  }
});

els.trimPlay.addEventListener('click', () => {
  if (els.trimVideo.paused) {
    if (els.trimVideo.currentTime < trimStartPct * trimDuration ||
        els.trimVideo.currentTime > trimEndPct * trimDuration - 0.05) {
      els.trimVideo.currentTime = trimStartPct * trimDuration;
    }
    els.trimVideo.play();
    els.trimPlayIcon.setAttribute('d', 'M6 4h4v16H6zM14 4h4v16h-4z'); // pause
  } else {
    els.trimVideo.pause();
    els.trimPlayIcon.setAttribute('d', 'M8 5v14l11-7z'); // play
  }
});
els.trimVideo.addEventListener('pause', () => {
  els.trimPlayIcon.setAttribute('d', 'M8 5v14l11-7z');
});
els.trimVideo.addEventListener('play', () => {
  els.trimPlayIcon.setAttribute('d', 'M6 4h4v16H6zM14 4h4v16h-4z');
});

function setHandlePct(side, pct) {
  pct = Math.max(0, Math.min(1, pct));
  if (side === 'start') {
    trimStartPct = Math.min(pct, trimEndPct - 0.001);
    els.trimHandleStart.style.left = `${trimStartPct * 100}%`;
  } else {
    trimEndPct = Math.max(pct, trimStartPct + 0.001);
    els.trimHandleEnd.style.left = `${trimEndPct * 100}%`;
  }
  els.trimRange.style.left  = `${trimStartPct * 100}%`;
  els.trimRange.style.right = `${(1 - trimEndPct) * 100}%`;
}

function bindHandle(handle, side) {
  let dragging = false;
  function onPointerDown(e) {
    dragging = true;
    handle.classList.add('dragging');
    handle.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e) {
    if (!dragging) return;
    const rect = els.trimTrack.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    setHandlePct(side, pct);
    if (trimDuration > 0) {
      const seconds = (side === 'start' ? trimStartPct : trimEndPct) * trimDuration;
      const fld = side === 'start' ? els.trimStart : els.trimEnd;
      fld.value = fmtDuration(seconds);
      // Scrub the video to the active handle.
      els.trimVideo.currentTime = seconds;
    }
    updateTrimHint();
  }
  function onPointerUp(e) {
    dragging = false;
    handle.classList.remove('dragging');
    try { handle.releasePointerCapture(e.pointerId); } catch (_) {}
  }
  handle.addEventListener('pointerdown', onPointerDown);
  handle.addEventListener('pointermove', onPointerMove);
  handle.addEventListener('pointerup', onPointerUp);
  handle.addEventListener('pointercancel', onPointerUp);
}
bindHandle(els.trimHandleStart, 'start');
bindHandle(els.trimHandleEnd, 'end');

// Click on the track (anywhere not on a handle) seeks the video.
els.trimTrack.addEventListener('click', (e) => {
  if (e.target.classList.contains('trim-handle')) return;
  if (!trimDuration) return;
  const rect = els.trimTrack.getBoundingClientRect();
  const pct = (e.clientX - rect.left) / rect.width;
  els.trimVideo.currentTime = Math.max(0, Math.min(trimDuration, pct * trimDuration));
});

// ---------- Custom MB ----------
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
function setCustomMb(value, source) {
  let n = parseFloat(value);
  if (!Number.isFinite(n) || n < 1) n = 1;
  if (source !== 'number') els.customMb.value = String(Math.round(n * 100) / 100);
  if (source !== 'slider') els.customMbSlider.value = String(clamp(n, 1, 500));
  els.customTierDisplay.textContent = `${els.customMb.value} MB`;
  const sliderPct = (clamp(n, 1, 500) - 1) / 499 * 100;
  els.customMbSlider.style.setProperty('--filled', `${sliderPct}%`);
}
els.customMbSlider.addEventListener('input', () => setCustomMb(els.customMbSlider.value, 'slider'));
els.customMb.addEventListener('input', () => setCustomMb(els.customMb.value, 'number'));
els.customMb.addEventListener('focus', () => selectTier('custom'));

function selectTier(name) {
  const radio = document.querySelector(`input[name="tier"][value="${name}"]`);
  if (radio) radio.checked = true;
  syncCustomRow();
}
function syncCustomRow() {
  els.customMbRow.hidden = getTier() !== 'custom';
}
document.querySelectorAll('input[name="tier"]').forEach(r =>
  r.addEventListener('change', syncCustomRow));
setCustomMb(els.customMb.value, null);
syncCustomRow();

// ===========================================================================
// SYSTEM RESOURCES
// ===========================================================================

const RING_CIRCUM = 263.9;
const cpuRing = document.getElementById('cpu-ring');
const ramRing = document.getElementById('ram-ring');
const cpuValue = document.getElementById('cpu-value');
const cpuMeta = document.getElementById('cpu-meta');
const ramValue = document.getElementById('ram-value');
const ramMeta = document.getElementById('ram-meta');
const encValue = document.getElementById('enc-value');
const encMeta = document.getElementById('enc-meta');
const encBar = document.getElementById('enc-bar');
const encCard = encBar.closest('.stat-card');

function setRing(circle, percent) {
  const clamped = Math.max(0, Math.min(100, percent));
  circle.style.strokeDashoffset = String(RING_CIRCUM * (1 - clamped / 100));
}
function fmtBytes(n) {
  if (n >= 1024 ** 3) return (n / 1024 ** 3).toFixed(1) + ' GB';
  if (n >= 1024 ** 2) return (n / 1024 ** 2).toFixed(0) + ' MB';
  return (n / 1024).toFixed(0) + ' KB';
}
const tweens = new WeakMap();
function tweenNumber(el, target, suffix = '', durMs = 600) {
  const start = parseFloat(el.dataset.cur || '0');
  const t0 = performance.now();
  if (tweens.get(el)) cancelAnimationFrame(tweens.get(el));
  function step(now) {
    const t = Math.min(1, (now - t0) / durMs);
    const eased = 1 - Math.pow(1 - t, 3);
    const v = start + (target - start) * eased;
    el.textContent = `${v.toFixed(0)}${suffix}`;
    el.dataset.cur = String(v);
    if (t < 1) tweens.set(el, requestAnimationFrame(step));
  }
  tweens.set(el, requestAnimationFrame(step));
}

window.api.onStats(({ cpuPercent, memUsed, memTotal, memPercent, cpuModel, cpuCores, activeFfmpeg }) => {
  setRing(cpuRing, cpuPercent);
  setRing(ramRing, memPercent);
  tweenNumber(cpuValue, cpuPercent, '%');
  tweenNumber(ramValue, memPercent, '%');
  cpuMeta.textContent = `${cpuCores} cores · ${cpuModel.trim().split(/\s+/).slice(0, 4).join(' ')}`;
  ramMeta.textContent = `${fmtBytes(memUsed)} / ${fmtBytes(memTotal)}`;
  if (activeFfmpeg > 0) {
    encCard.classList.add('is-active');
    encValue.textContent = 'Encoding';
    encMeta.textContent = `${activeFfmpeg} ffmpeg process${activeFfmpeg > 1 ? 'es' : ''}`;
  } else {
    encCard.classList.remove('is-active');
    encValue.textContent = 'Idle';
    encMeta.textContent = 'No active ffmpeg';
    if (!els.startBtn.classList.contains('is-loading')) encBar.style.width = '0%';
  }
});

// ===========================================================================
// COMPRESSION FLOW (sequential queue)
// ===========================================================================

function fmtSec(s) {
  if (!Number.isFinite(s)) return '';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}

window.api.onProgress(({ phase, percent, currentSec, durationSec, speed }) => {
  els.progressFill.style.width = `${percent.toFixed(1)}%`;
  encBar.style.width = `${percent.toFixed(1)}%`;
  els.phase.textContent = phase;
  let info = durationSec ? `${fmtSec(currentSec)} / ${fmtSec(durationSec)}` : '';
  if (speed && speed > 0 && durationSec) {
    const remaining = Math.max(0, durationSec - currentSec);
    const eta = remaining / speed;
    if (Number.isFinite(eta) && eta > 0.5) info += `  ·  ETA ${fmtSec(eta)}  ·  ${speed.toFixed(2)}x`;
  }
  els.timeInfo.textContent = info;
  // Mirror into the running queue item.
  if (runningId !== null) {
    const item = queue.find(q => q.id === runningId);
    if (item) {
      item.progress = percent;
      // Lightweight DOM update — only the running item's progress fill +
      // status text — instead of a full renderQueue() each frame.
      const li = els.queueList.children[queue.indexOf(item)];
      if (li) {
        const fill = li.querySelector('.q-progress-fill');
        if (fill) fill.style.width = `${percent}%`;
        const status = li.querySelector('.q-status');
        if (status) status.textContent = `encoding ${percent.toFixed(0)}%`;
      }
    }
  }
});

function setBusy(busy) {
  els.startBtn.disabled = busy;
  els.startBtn.classList.toggle('is-loading', busy);
  els.cancelBtn.disabled = !busy;
  els.progress.classList.toggle('is-active', busy);
}

async function startCompress() {
  if (runningId !== null) return; // already running

  const queued = queue.filter(q => q.status === 'queued');
  if (!queued.length) {
    return toast('error', 'Queue is empty', 'Add at least one video.');
  }

  // Validate tier / target only once for the batch — they apply uniformly.
  const targetMb = mode === 'crf' ? null : resolveTargetMb();
  if (mode !== 'crf' && targetMb === null) return;

  const env = await window.api.checkEnv();
  if (!env.ffmpeg || !env.ffprobe) {
    return toast('error', 'ffmpeg not found', ffmpegHint(env.platform));
  }

  // Validate trim once (applied to every item in the queue — usually only
  // makes sense for a single-item queue, but it works for all).
  const trimStart = parseTime(els.trimStart.value) || 0;
  const trimEnd = parseTime(els.trimEnd.value);
  if ((els.trimStart.value && Number.isNaN(trimStart)) ||
      (els.trimEnd.value && Number.isNaN(trimEnd))) {
    return toast('error', 'Invalid trim time', 'Use mm:ss, hh:mm:ss, or seconds.');
  }

  setBusy(true);
  queueCancelled = false;

  let okCount = 0, failCount = 0;
  for (const item of queued) {
    if (queueCancelled) {
      item.status = 'failed';
      item.error = 'Cancelled before start';
      continue;
    }
    runningId = item.id;
    item.status = 'encoding';
    item.progress = 0;
    renderQueue();
    els.phase.textContent = `${basename(item.input)} — probing...`;
    els.timeInfo.textContent = '';
    els.progressFill.style.width = '0%';

    const audioKbps = TIERS[getTier()].audioKbps;
    const result = await window.api.startCompress({
      input: item.input,
      output: item.output,
      targetMb,
      audioKbps,
      codec: els.codecSelect.value || 'libx264',
      presetLevel,
      mode,
      trimStart,
      trimEnd: Number.isFinite(trimEnd) ? trimEnd : null,
      removeAudio: els.muteAudio.checked,
      crf: parseInt(els.crfSlider.value, 10),
      burnSubtitles: els.burnSubs.checked,
    });

    if (result.ok) {
      item.status = 'done';
      item.sizeMb = result.sizeMb;
      item.output = result.output;
      okCount++;
    } else {
      item.status = 'failed';
      item.error = result.error || 'failed';
      failCount++;
      if (result.error === 'Cancelled') queueCancelled = true; // user cancelled — stop the queue
    }
    runningId = null;
    renderQueue();
  }

  setBusy(false);
  els.phase.textContent = 'Ready';

  if (queue.length === 1 && okCount === 1) {
    const only = queue[0];
    toast('success', 'Compressed!',
      `Final size: ${only.sizeMb.toFixed(2)} MB`,
      { label: 'Show in folder', onClick: () => window.api.revealInFolder(only.output) });
  } else if (okCount > 0 || failCount > 0) {
    const kind = failCount === 0 ? 'success' : (okCount === 0 ? 'error' : 'info');
    toast(kind, 'Queue finished', `${okCount} succeeded, ${failCount} failed.`);
  }
}

els.startBtn.addEventListener('click', startCompress);
els.cancelBtn.addEventListener('click', () => {
  queueCancelled = true;
  window.api.cancelCompress();
});
els.exportLogBtn.addEventListener('click', async () => {
  const p = await window.api.saveLog();
  if (p) toast('success', 'Log saved', p, {
    label: 'Show in folder', onClick: () => window.api.revealInFolder(p),
  });
});

// ---------- Keyboard shortcuts ----------
function isTypingTarget(t) {
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!els.cancelBtn.disabled) {
      e.preventDefault();
      queueCancelled = true;
      window.api.cancelCompress();
    }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey) {
    if (e.key === '1') { e.preventDefault(); activateTab('compress'); return; }
    if (e.key === '2') { e.preventDefault(); activateTab('encoding'); return; }
    if (e.key === '3') { e.preventDefault(); activateTab('system');   return; }
  }
  if (isTypingTarget(e.target)) return;
  if (e.code === 'Space') {
    e.preventDefault();
    if (!els.startBtn.disabled) startCompress();
  } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
    e.preventDefault();
    els.exportLogBtn.click();
  }
});

// ---------- Initial environment check ----------
function ffmpegHint(platform) {
  if (platform === 'linux')   return 'Install ffmpeg via your package manager: sudo apt install ffmpeg (or dnf / pacman).';
  if (platform === 'darwin')  return 'Install ffmpeg via Homebrew: brew install ffmpeg.';
  return 'Install ffmpeg from ffmpeg.org, or place it at C:\\ffmpeg\\bin.';
}

window.api.onEncoders(populateCodecs);
(async () => {
  const env = await window.api.checkEnv();
  els.versionTag.textContent = `v${env.appVersion}`;
  osIsDark = !!env.isDarkOS;
  if (document.documentElement.dataset.themeChoice === 'auto') applyTheme('auto');

  if (!env.ffmpeg || !env.ffprobe) {
    toast('error', 'ffmpeg missing', ffmpegHint(env.platform));
  } else if (env.encoders && env.encoders.length) {
    populateCodecs(env.encoders);
  } else {
    populateCodecs(['libx264']);
  }

  const upd = await window.api.checkUpdate();
  if (upd && upd.latest) {
    toast('info', `Update available: ${upd.latest}`,
      `You're on v${upd.current}.`,
      { label: 'Open release page', onClick: () => window.api.openExternal(upd.url) });
  }
})();
