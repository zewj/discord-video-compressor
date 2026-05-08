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

  audioKbpsSlider: document.getElementById('audio-kbps-slider'),
  audioKbpsValue: document.getElementById('audio-kbps-value'),
  audioCopy: document.getElementById('audio-copy'),
  audioHint: document.getElementById('audio-hint'),
  subTrack: document.getElementById('sub-track'),
  subStyleRow: document.getElementById('sub-style-row'),
  subStylePreset: document.getElementById('sub-style-preset'),
  subCustomRow: document.getElementById('sub-custom-row'),
  subFont: document.getElementById('sub-font'),
  subSize: document.getElementById('sub-size'),
  subColor: document.getElementById('sub-color'),
  subOutline: document.getElementById('sub-outline'),
  customRes: document.getElementById('custom-res'),
  customFps: document.getElementById('custom-fps'),
  concurrencySlider: document.getElementById('concurrency-slider'),
  concurrencyValue: document.getElementById('concurrency-value'),
  crfQualityLabel: document.getElementById('crf-quality-label'),
  profileSelect: document.getElementById('profile-select'),
  profileSave: document.getElementById('profile-save'),
  profileDelete: document.getElementById('profile-delete'),

  dropOverlay: document.getElementById('drop-overlay'),
};

// ---------- Generic settings persistence ----------
// Tracks a few user choices across launches without writing a file. Each
// call returns the saved value (or default) and registers a setter that
// updates localStorage. Keeps the per-control wiring concise.
function persistedValue(key, defaultValue) {
  let cur;
  try { cur = localStorage.getItem(key); } catch (_) { cur = null; }
  if (cur === null || cur === undefined) cur = defaultValue;
  return {
    get: () => cur,
    set: (v) => {
      cur = v;
      try { localStorage.setItem(key, String(v)); } catch (_) {}
    },
  };
}
function persistedBool(key, def) {
  const p = persistedValue(key, def ? '1' : '0');
  return { get: () => p.get() === '1', set: (b) => p.set(b ? '1' : '0') };
}
function persistedInt(key, def) {
  const p = persistedValue(key, String(def));
  return { get: () => parseInt(p.get(), 10) || def, set: (n) => p.set(String(n)) };
}
const savedMode        = persistedValue('dvc.mode', 'fast');
const savedPreset      = persistedValue('dvc.preset', 'balanced');
const savedTier        = persistedValue('dvc.tier', 'free');
const savedMute        = persistedBool('dvc.mute', false);
const savedBurnSubs    = persistedBool('dvc.burnSubs', false);
const savedCrf         = persistedInt('dvc.crf', 60);
const savedAudioKbps   = persistedInt('dvc.audioKbps', 128);
const savedAudioCopy   = persistedBool('dvc.audioCopy', false);
const savedConcurrency = persistedInt('dvc.concurrency', 1);
const savedCustomRes   = persistedValue('dvc.customRes', '');
const savedCustomFps   = persistedValue('dvc.customFps', '');

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

let queue = [];           // [{ id, jobId?, input, output, status, progress, sizeMb?, error?, info? }]
let nextId = 1;
let queueCancelled = false;
const anyEncoding = () => queue.some(q => q.status === 'encoding');

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
  const item = queue.find(q => q.id === id);
  if (!item || item.status === 'encoding') return; // can't remove an active encode
  queue = queue.filter(q => q.id !== id);
  renderQueue();
}

function clearQueue() {
  if (anyEncoding()) return;
  queue = [];
  renderQueue();
  unloadTrimPreview();
}

function renderQueue() {
  els.queueList.innerHTML = '';
  els.queueList.hidden = queue.length === 0;
  els.emptyHint.hidden = queue.length > 0;
  els.clearQueue.disabled = queue.length === 0 || anyEncoding();
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

let mode = savedMode.get();
let presetLevel = savedPreset.get();
let concurrency = Math.max(1, Math.min(4, savedConcurrency.get()));

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
    savedMode.set(mode);
    document.querySelectorAll('.seg-btn[data-mode]').forEach(x =>
      x.classList.toggle('active', x === b));
    els.crfRow.hidden = mode !== 'crf';
  });
});
document.querySelectorAll('.seg-btn[data-preset]').forEach(b => {
  b.addEventListener('click', () => {
    presetLevel = b.dataset.preset;
    savedPreset.set(presetLevel);
    document.querySelectorAll('.seg-btn[data-preset]').forEach(x =>
      x.classList.toggle('active', x === b));
  });
});

// Per-codec CRF rough-quality table. The slider is 0..100 normalised; the
// underlying CRF values shift by codec, but the perceptual buckets line up
// at the same percentages because qualityArgsFor uses linear lerp on each
// codec's "low quality" → "high quality" range.
function crfQualityLabel(pct) {
  if (pct >= 85) return '~ Visually lossless';
  if (pct >= 70) return '~ Very good';
  if (pct >= 50) return '~ Good';
  if (pct >= 30) return '~ Acceptable';
  return '~ Low quality';
}
els.crfSlider.addEventListener('input', () => {
  els.crfValue.textContent = els.crfSlider.value;
  const pct = parseInt(els.crfSlider.value, 10) || 0;
  els.crfQualityLabel.textContent = `${crfQualityLabel(pct)} · file size will be whatever it is`;
  savedCrf.set(pct);
});

// ---------- Audio bitrate / passthrough ----------
function refreshAudioHint() {
  if (els.audioCopy.checked) {
    els.audioHint.textContent = 'Source audio will be copied without re-encoding when possible.';
    els.audioKbpsSlider.disabled = true;
  } else {
    els.audioHint.textContent = `Tier defaults: No Nitro 64, Basic 96, Boost/Nitro 128.`;
    els.audioKbpsSlider.disabled = false;
  }
}
els.audioKbpsSlider.addEventListener('input', () => {
  els.audioKbpsValue.textContent = els.audioKbpsSlider.value;
  savedAudioKbps.set(parseInt(els.audioKbpsSlider.value, 10));
  // Repaint slider gradient.
  const pct = (els.audioKbpsSlider.value - 32) / (256 - 32) * 100;
  els.audioKbpsSlider.style.setProperty('--filled', `${pct}%`);
});
els.audioCopy.addEventListener('change', () => {
  savedAudioCopy.set(els.audioCopy.checked);
  refreshAudioHint();
});

// ---------- Custom resolution / framerate ----------
els.customRes.addEventListener('change', () => savedCustomRes.set(els.customRes.value.trim()));
els.customFps.addEventListener('change', () => savedCustomFps.set(els.customFps.value.trim()));

// ---------- Concurrency ----------
els.concurrencySlider.addEventListener('input', () => {
  concurrency = parseInt(els.concurrencySlider.value, 10) || 1;
  els.concurrencyValue.textContent = String(concurrency);
  savedConcurrency.set(concurrency);
  const pct = (concurrency - 1) / 3 * 100;
  els.concurrencySlider.style.setProperty('--filled', `${pct}%`);
});

// ---------- Subtitle track dropdown ----------
function populateSubtitleTracks(streams) {
  els.subTrack.innerHTML = '';
  if (!streams || streams.length === 0) {
    els.subTrack.hidden = true;
    els.subsHint.textContent = 'Source has no subtitle tracks.';
    els.burnSubs.disabled = true;
    return;
  }
  for (const s of streams) {
    const opt = document.createElement('option');
    opt.value = String(s.index);
    const lang = s.language ? ` [${s.language}]` : '';
    const title = s.title ? ` — ${s.title}` : '';
    opt.textContent = `Track ${s.index + 1} (${s.codec})${lang}${title}`;
    els.subTrack.appendChild(opt);
  }
  els.subTrack.hidden = streams.length < 2; // only show selector if there's a choice
  els.burnSubs.disabled = false;
  els.subsHint.textContent = streams.length === 1
    ? `1 subtitle track found (${streams[0].codec}).`
    : `${streams.length} subtitle tracks found — pick one above.`;
}

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
  // Populate subtitle track selector from probe data.
  if (item.info && item.info.subtitleStreams) {
    populateSubtitleTracks(item.info.subtitleStreams);
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

// ---------- Persist mute / burn-subs / tier on change ----------
els.muteAudio.addEventListener('change', () => savedMute.set(els.muteAudio.checked));
els.burnSubs.addEventListener('change', () => savedBurnSubs.set(els.burnSubs.checked));
document.querySelectorAll('input[name="tier"]').forEach(r =>
  r.addEventListener('change', () => savedTier.set(r.value)));

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

// Map jobId -> latest progress fields, used for global aggregate ETA.
const jobProgress = new Map();

window.api.onProgress(({ jobId, phase, percent, currentSec, durationSec, speed }) => {
  // Global progress bar shows the aggregate when running queue, or single
  // job progress when only one is active.
  jobProgress.set(jobId, { phase, percent, currentSec, durationSec, speed });

  // Find the queue item by jobId.
  const item = queue.find(q => q.jobId === jobId);
  if (item) {
    item.progress = percent;
    const idx = queue.indexOf(item);
    const li = els.queueList.children[idx];
    if (li) {
      const fill = li.querySelector('.q-progress-fill');
      if (fill) fill.style.width = `${percent}%`;
      const status = li.querySelector('.q-status');
      if (status) status.textContent = `encoding ${percent.toFixed(0)}%`;
    }
  }

  updateGlobalProgress();
});

// Compute a global queue ETA that schedules all remaining work across the
// configured concurrency slots: each slot is "busy" for the active job's
// remaining time, then becomes free; queued items are assigned in order to
// whichever slot frees up first. The ETA is the max slot busy-time.
function computeQueueEta() {
  const active = queue.filter(q => q.status === 'encoding');
  const queued = queue.filter(q => q.status === 'queued');
  if (!active.length && !queued.length) return null;

  // Average speed across active jobs (default 1.0× when we have no data yet).
  let totalSpeed = 0, speedCount = 0;
  for (const a of active) {
    const d = jobProgress.get(a.jobId);
    if (d && d.speed) { totalSpeed += d.speed; speedCount++; }
  }
  const avgSpeed = speedCount > 0 ? totalSpeed / speedCount : 1.0;

  const slots = Math.max(1, concurrency);
  const slotTimes = new Array(slots).fill(0);

  // Seed each slot with an active job's remaining time.
  active.slice(0, slots).forEach((a, i) => {
    const d = jobProgress.get(a.jobId);
    if (d && d.durationSec && d.speed) {
      slotTimes[i] = Math.max(0, d.durationSec - d.currentSec) / d.speed;
    }
  });

  // Assign each queued item to the slot that frees up earliest.
  for (const q of queued) {
    const dur = q.info?.duration || 30; // fall back to 30s if probe didn't run
    const cost = dur / avgSpeed;
    let minIdx = 0;
    for (let i = 1; i < slots; i++) {
      if (slotTimes[i] < slotTimes[minIdx]) minIdx = i;
    }
    slotTimes[minIdx] += cost;
  }

  return Math.max(...slotTimes);
}

function updateGlobalProgress() {
  const active = queue.filter(q => q.status === 'encoding');
  if (active.length === 0) return;
  if (active.length === 1 && queue.filter(q => q.status === 'queued').length === 0) {
    const item = active[0];
    const data = jobProgress.get(item.jobId);
    if (!data) return;
    els.progressFill.style.width = `${data.percent.toFixed(1)}%`;
    encBar.style.width = `${data.percent.toFixed(1)}%`;
    els.phase.textContent = `${basename(item.input)} — ${data.phase}`;
    let info = data.durationSec ? `${fmtSec(data.currentSec)} / ${fmtSec(data.durationSec)}` : '';
    if (data.speed && data.speed > 0 && data.durationSec) {
      const remaining = Math.max(0, data.durationSec - data.currentSec);
      const eta = remaining / data.speed;
      if (Number.isFinite(eta) && eta > 0.5) info += `  ·  ETA ${fmtSec(eta)}  ·  ${data.speed.toFixed(2)}x`;
    }
    els.timeInfo.textContent = info;
  } else {
    // Multiple jobs running in parallel and/or queued items waiting.
    const totalDone = queue.filter(q => q.status === 'done').length;
    const grand = queue.length;
    const avgPct = active.reduce((s, q) => s + (q.progress || 0), 0) / active.length;
    els.progressFill.style.width = `${avgPct.toFixed(1)}%`;
    encBar.style.width = `${avgPct.toFixed(1)}%`;
    els.phase.textContent = `${active.length} active · ${totalDone}/${grand} done`;
    const eta = computeQueueEta();
    els.timeInfo.textContent = eta && eta > 0.5
      ? `Queue ETA ${fmtSec(eta)}`
      : '';
  }
}

function setBusy(busy) {
  els.startBtn.disabled = busy;
  els.startBtn.classList.toggle('is-loading', busy);
  els.cancelBtn.disabled = !busy;
  els.progress.classList.toggle('is-active', busy);
}

async function startCompress() {
  if (queue.some(q => q.status === 'encoding')) return; // already running

  const queued = queue.filter(q => q.status === 'queued');
  if (!queued.length) return toast('error', 'Queue is empty', 'Add at least one video.');

  const targetMb = mode === 'crf' ? null : resolveTargetMb();
  if (mode !== 'crf' && targetMb === null) return;

  const env = await window.api.checkEnv();
  if (!env.ffmpeg || !env.ffprobe) {
    return toast('error', 'ffmpeg not found', ffmpegHint(env.platform));
  }

  const trimStart = parseTime(els.trimStart.value) || 0;
  const trimEnd = parseTime(els.trimEnd.value);
  if ((els.trimStart.value && Number.isNaN(trimStart)) ||
      (els.trimEnd.value && Number.isNaN(trimEnd))) {
    return toast('error', 'Invalid trim time', 'Use mm:ss, hh:mm:ss, or seconds.');
  }

  setBusy(true);
  queueCancelled = false;
  jobProgress.clear();

  // Shared options for all queued items.
  const audioKbps = els.audioCopy.checked
    ? TIERS[getTier()].audioKbps    // ignored when audioCopy=true; harmless
    : parseInt(els.audioKbpsSlider.value, 10) || 128;
  const subtitleTrack = parseInt(els.subTrack.value, 10) || 0;

  const sharedOpts = {
    targetMb,
    audioKbps,
    audioCopy: els.audioCopy.checked,
    codec: els.codecSelect.value || 'libx264',
    presetLevel,
    mode,
    trimStart,
    trimEnd: Number.isFinite(trimEnd) ? trimEnd : null,
    removeAudio: els.muteAudio.checked,
    crf: parseInt(els.crfSlider.value, 10),
    burnSubtitles: els.burnSubs.checked,
    subtitleTrack,
    subtitleStyle: els.burnSubs.checked ? buildSubtitleStyle() : null,
    customResolution: els.customRes.value.trim() || null,
    customFramerate: els.customFps.value.trim() || null,
  };

  // Encode one item; promise resolves when that item finishes (success or fail).
  async function encodeOne(item) {
    item.status = 'encoding';
    item.progress = 0;
    item.jobId = `q-${item.id}-${Date.now().toString(36)}`;
    renderQueue();

    const r = await window.api.startCompress({
      ...sharedOpts,
      input: item.input,
      output: item.output,
      jobId: item.jobId,
    });
    if (r.ok) {
      item.status = 'done';
      item.sizeMb = r.sizeMb;
      item.output = r.output;
    } else {
      item.status = 'failed';
      item.error = r.error || 'failed';
      if (r.error === 'Cancelled') queueCancelled = true;
    }
    jobProgress.delete(item.jobId);
    renderQueue();
  }

  // Concurrency-limited pool: launch up to N at a time, replenish as they
  // finish. Promise.race tells us when the next slot frees up.
  const N = Math.max(1, concurrency);
  const inFlight = new Set();
  const remaining = queued.slice();

  const launch = () => {
    while (inFlight.size < N && remaining.length > 0 && !queueCancelled) {
      const item = remaining.shift();
      const p = encodeOne(item).finally(() => inFlight.delete(p));
      inFlight.add(p);
    }
  };

  launch();
  while (inFlight.size > 0) {
    await Promise.race(inFlight);
    launch();
  }

  setBusy(false);
  els.phase.textContent = 'Ready';
  els.timeInfo.textContent = '';
  els.progressFill.style.width = '0%';

  const okCount = queue.filter(q => q.status === 'done').length;
  const failCount = queue.filter(q => q.status === 'failed').length;
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

// ===========================================================================
// SUBTITLE STYLING
// ===========================================================================

// Built-in style presets. force_style is libass syntax — the same options
// you'd put in an ASS file's Style block.
const SUB_STYLE_PRESETS = {
  default: '',
  bold:    'Fontname=Arial,Fontsize=28,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0',
  yellow:  'Fontname=Arial,Fontsize=26,Bold=1,PrimaryColour=&H0000FFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=1',
  movie:   'Fontname=Arial,Fontsize=24,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=1,Shadow=2',
  custom:  null,
};

// Convert "#RRGGBB" → libass "&HBBGGRR" hex (BGR order, alpha implicit 00).
function colorToAss(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return '&H00FFFFFF';
  const r = m[1].slice(0, 2);
  const g = m[1].slice(2, 4);
  const b = m[1].slice(4, 6);
  return `&H00${b}${g}${r}`.toUpperCase();
}

function buildSubtitleStyle() {
  const preset = els.subStylePreset.value;
  if (preset !== 'custom') return SUB_STYLE_PRESETS[preset] || '';
  const parts = [];
  if (els.subFont.value.trim())  parts.push(`Fontname=${els.subFont.value.trim()}`);
  if (els.subSize.value)         parts.push(`Fontsize=${parseInt(els.subSize.value, 10)}`);
  parts.push(`PrimaryColour=${colorToAss(els.subColor.value)}`);
  if (els.subOutline.value)      parts.push(`Outline=${parseInt(els.subOutline.value, 10)}`,
                                            'BorderStyle=1');
  return parts.join(',');
}

function syncSubsUI() {
  const enabled = els.burnSubs.checked && !els.burnSubs.disabled;
  els.subStyleRow.hidden = !enabled;
  els.subCustomRow.hidden = els.subStylePreset.value !== 'custom';
}
els.burnSubs.addEventListener('change', syncSubsUI);
els.subStylePreset.addEventListener('change', syncSubsUI);

// ===========================================================================
// PROFILES (save/load/delete encoding presets)
// ===========================================================================

const PROFILES_KEY = 'dvc.profiles';
function loadProfiles() {
  try { return JSON.parse(localStorage.getItem(PROFILES_KEY) || '[]'); }
  catch { return []; }
}
function saveProfiles(arr) {
  try { localStorage.setItem(PROFILES_KEY, JSON.stringify(arr)); } catch (_) {}
}

function snapshotCurrentSettings() {
  return {
    codec: els.codecSelect.value,
    mode,
    presetLevel,
    tier: getTier(),
    customMb: parseFloat(els.customMb.value),
    audioKbps: parseInt(els.audioKbpsSlider.value, 10),
    audioCopy: els.audioCopy.checked,
    removeAudio: els.muteAudio.checked,
    burnSubs: els.burnSubs.checked,
    subStylePreset: els.subStylePreset.value,
    subFont: els.subFont.value,
    subSize: els.subSize.value,
    subColor: els.subColor.value,
    subOutline: els.subOutline.value,
    customRes: els.customRes.value,
    customFps: els.customFps.value,
    crf: parseInt(els.crfSlider.value, 10),
    concurrency,
  };
}

function applyProfile(p) {
  if (!p) return;
  if (p.codec) {
    const opt = Array.from(els.codecSelect.options).find(o => o.value === p.codec);
    if (opt) els.codecSelect.value = p.codec;
  }
  if (p.mode) {
    const btn = document.querySelector(`.seg-btn[data-mode="${p.mode}"]`);
    if (btn && !btn.disabled) btn.click();
  }
  if (p.presetLevel) {
    const btn = document.querySelector(`.seg-btn[data-preset="${p.presetLevel}"]`);
    if (btn) btn.click();
  }
  if (p.tier) {
    const r = document.querySelector(`input[name="tier"][value="${p.tier}"]`);
    if (r) { r.checked = true; syncCustomRow(); savedTier.set(p.tier); }
  }
  if (Number.isFinite(p.customMb)) {
    setCustomMb(p.customMb, null);
  }
  if (Number.isFinite(p.audioKbps)) {
    els.audioKbpsSlider.value = String(p.audioKbps);
    els.audioKbpsSlider.dispatchEvent(new Event('input'));
  }
  if (typeof p.audioCopy === 'boolean')  { els.audioCopy.checked = p.audioCopy;  refreshAudioHint(); savedAudioCopy.set(p.audioCopy); }
  if (typeof p.removeAudio === 'boolean'){ els.muteAudio.checked = p.removeAudio; savedMute.set(p.removeAudio); }
  if (typeof p.burnSubs === 'boolean')   { els.burnSubs.checked = p.burnSubs;    savedBurnSubs.set(p.burnSubs); }
  if (p.subStylePreset)  els.subStylePreset.value = p.subStylePreset;
  if (p.subFont != null) els.subFont.value = p.subFont;
  if (p.subSize != null) els.subSize.value = p.subSize;
  if (p.subColor)        els.subColor.value = p.subColor;
  if (p.subOutline != null) els.subOutline.value = p.subOutline;
  syncSubsUI();
  if (p.customRes != null) { els.customRes.value = p.customRes; savedCustomRes.set(p.customRes); }
  if (p.customFps != null) { els.customFps.value = p.customFps; savedCustomFps.set(p.customFps); }
  if (Number.isFinite(p.crf)) {
    els.crfSlider.value = String(p.crf);
    els.crfSlider.dispatchEvent(new Event('input'));
  }
  if (Number.isFinite(p.concurrency)) {
    concurrency = Math.max(1, Math.min(4, p.concurrency));
    els.concurrencySlider.value = String(concurrency);
    els.concurrencySlider.dispatchEvent(new Event('input'));
  }
}

function refreshProfileDropdown(selectedName) {
  const profiles = loadProfiles();
  els.profileSelect.innerHTML = '';
  const def = document.createElement('option');
  def.value = ''; def.textContent = '— Built-in defaults —';
  els.profileSelect.appendChild(def);
  for (const p of profiles) {
    const opt = document.createElement('option');
    opt.value = p.name;
    opt.textContent = p.name;
    els.profileSelect.appendChild(opt);
  }
  if (selectedName) els.profileSelect.value = selectedName;
  els.profileDelete.disabled = !els.profileSelect.value;
}

els.profileSelect.addEventListener('change', () => {
  const name = els.profileSelect.value;
  els.profileDelete.disabled = !name;
  if (!name) return;
  const profiles = loadProfiles();
  const p = profiles.find(x => x.name === name);
  if (p) {
    applyProfile(p.settings);
    toast('info', 'Profile applied', name);
  }
});

els.profileSave.addEventListener('click', () => {
  const name = (prompt('Profile name:', '') || '').trim();
  if (!name) return;
  const profiles = loadProfiles();
  const idx = profiles.findIndex(p => p.name === name);
  const entry = { name, settings: snapshotCurrentSettings() };
  if (idx >= 0) profiles[idx] = entry; else profiles.push(entry);
  saveProfiles(profiles);
  refreshProfileDropdown(name);
  toast('success', 'Profile saved', name);
});

els.profileDelete.addEventListener('click', () => {
  const name = els.profileSelect.value;
  if (!name) return;
  if (!confirm(`Delete profile "${name}"?`)) return;
  saveProfiles(loadProfiles().filter(p => p.name !== name));
  refreshProfileDropdown('');
  toast('info', 'Profile deleted', name);
});

// ---------- Restore persisted settings on startup ----------
function restorePersistedSettings() {
  // Mode segment.
  const modeBtn = document.querySelector(`.seg-btn[data-mode="${savedMode.get()}"]`);
  if (modeBtn && !modeBtn.disabled) modeBtn.click();
  // Preset segment.
  const presetBtn = document.querySelector(`.seg-btn[data-preset="${savedPreset.get()}"]`);
  if (presetBtn) presetBtn.click();
  // Tier radio.
  const tierRadio = document.querySelector(`input[name="tier"][value="${savedTier.get()}"]`);
  if (tierRadio) { tierRadio.checked = true; syncCustomRow(); }
  // Checkboxes.
  els.muteAudio.checked = savedMute.get();
  els.burnSubs.checked  = savedBurnSubs.get();
  els.audioCopy.checked = savedAudioCopy.get();
  // CRF slider + label.
  els.crfSlider.value = String(savedCrf.get());
  els.crfValue.textContent = els.crfSlider.value;
  els.crfQualityLabel.textContent = `${crfQualityLabel(savedCrf.get())} · file size will be whatever it is`;
  // Audio bitrate slider.
  els.audioKbpsSlider.value = String(savedAudioKbps.get());
  els.audioKbpsValue.textContent = els.audioKbpsSlider.value;
  els.audioKbpsSlider.style.setProperty('--filled',
    `${(savedAudioKbps.get() - 32) / (256 - 32) * 100}%`);
  // Concurrency slider.
  els.concurrencySlider.value = String(concurrency);
  els.concurrencyValue.textContent = String(concurrency);
  els.concurrencySlider.style.setProperty('--filled', `${(concurrency - 1) / 3 * 100}%`);
  // Custom res / fps.
  els.customRes.value = savedCustomRes.get();
  els.customFps.value = savedCustomFps.get();
  refreshAudioHint();
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
  restorePersistedSettings();
  refreshProfileDropdown('');
  syncSubsUI();

  const upd = await window.api.checkUpdate();
  if (upd && upd.latest) {
    toast('info', `Update available: ${upd.latest}`,
      `You're on v${upd.current}.`,
      { label: 'Open release page', onClick: () => window.api.openExternal(upd.url) });
  }
})();
