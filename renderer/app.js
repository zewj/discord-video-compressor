const TIERS = {
  free:   { limitMb: 10,  safetyMb: 0.5, audioKbps: 64  },
  basic:  { limitMb: 50,  safetyMb: 1.0, audioKbps: 96  },
  nitro:  { limitMb: 500, safetyMb: 5.0, audioKbps: 128 },
  custom: { limitMb: null, safetyMb: 0.5, audioKbps: 96 },
};

// Friendly labels for each codec.
const CODEC_LABELS = {
  libx264:    'CPU H.264 (libx264)',
  libx265:    'CPU HEVC / H.265 (libx265)',
  h264_nvenc: 'NVIDIA NVENC H.264',
  hevc_nvenc: 'NVIDIA NVENC HEVC',
  h264_amf:   'AMD AMF H.264',
  hevc_amf:   'AMD AMF HEVC',
  h264_qsv:   'Intel QuickSync H.264',
  hevc_qsv:   'Intel QuickSync HEVC',
};
// Preferred default order: HW H.264 > CPU H.264 > anything else.
const CODEC_PRIORITY = [
  'h264_nvenc', 'h264_qsv', 'h264_amf',
  'libx264',
  'hevc_nvenc', 'hevc_qsv', 'hevc_amf',
  'libx265',
];

const els = {
  inputPath: document.getElementById('input-path'),
  outputPath: document.getElementById('output-path'),
  outputDisplay: document.getElementById('output-display'),
  pickInput: document.getElementById('pick-input'),
  pickOutput: document.getElementById('pick-output'),
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

  sourceInfo: document.getElementById('source-info'),
  srcDuration: document.getElementById('src-duration'),
  srcResolution: document.getElementById('src-resolution'),
  srcCodec: document.getElementById('src-codec'),
  srcSize: document.getElementById('src-size'),

  codecSelect: document.getElementById('codec-select'),
  codecHint: document.getElementById('codec-hint'),
  trimStart: document.getElementById('trim-start'),
  trimEnd: document.getElementById('trim-end'),
  trimClear: document.getElementById('trim-clear'),
  trimHint: document.getElementById('trim-hint'),
  muteAudio: document.getElementById('mute-audio'),

  dropOverlay: document.getElementById('drop-overlay'),
};

// ---------- Tabs ----------
const TAB_KEY = 'dvc.tab';
const tabButtons = document.querySelectorAll('.tab');
const tabPanels = document.querySelectorAll('.tab-panel');
const tabIndicator = document.querySelector('.tab-indicator');

function moveIndicatorTo(btn) {
  if (!btn || !tabIndicator) return;
  // offsetLeft/Width are relative to the .tabs container (its closest
  // positioned ancestor), which is what the indicator is absolutely
  // positioned within.
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
  if (activeBtn) {
    // Restart the panel entrance animation by re-flowing.
    requestAnimationFrame(() => moveIndicatorTo(activeBtn));
  }
  try { localStorage.setItem(TAB_KEY, name); } catch (_) {}
}

tabButtons.forEach(b => {
  b.addEventListener('click', () => activateTab(b.dataset.tab));
});

// Recompute the indicator's geometry on resize (font-load shifts, etc.).
window.addEventListener('resize', () => {
  const active = document.querySelector('.tab.active');
  moveIndicatorTo(active);
});

// Restore last-used tab on launch; default to Compress.
const initialTab = (() => {
  try { return localStorage.getItem(TAB_KEY) || 'compress'; }
  catch { return 'compress'; }
})();
// Defer one frame so the layout has measured.
requestAnimationFrame(() => activateTab(initialTab));

// ---------- Theme handling ----------
const THEME_KEY = 'dvc.theme';
const themeButtons = document.querySelectorAll('.theme-btn');
let osIsDark = true;

function effectiveTheme(name) {
  return name === 'auto' ? (osIsDark ? 'midnight' : 'light') : name;
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

// ---------- File pickers + auto output ----------
function setOutputPath(p) {
  els.outputPath.value = p || '';
  if (!p) {
    els.outputDisplay.textContent = '—';
    els.outputDisplay.title = '';
  } else {
    // Show only the basename; full path lives in the title tooltip.
    const slash = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
    els.outputDisplay.textContent = slash >= 0 ? p.slice(slash + 1) : p;
    els.outputDisplay.title = p;
  }
}

async function setInputPath(p) {
  if (!p) return;
  els.inputPath.value = p;
  const dot = p.lastIndexOf('.');
  const stem = dot >= 0 ? p.slice(0, dot) : p;
  const desired = stem + '_discord.mp4';
  // Auto-increment if the suggested target already exists.
  setOutputPath(await window.api.resolveAvailable(desired));
  // Show source info.
  showSourceInfo(p);
}

async function showSourceInfo(p) {
  els.sourceInfo.hidden = false;
  els.srcDuration.textContent   = '...';
  els.srcResolution.textContent = '...';
  els.srcCodec.textContent      = '...';
  els.srcSize.textContent       = '...';
  const info = await window.api.probeMedia(p);
  if (!info || info.error) {
    els.sourceInfo.hidden = true;
    if (info && info.error) toast('error', "Can't read video", info.error);
    return;
  }
  els.srcDuration.textContent   = fmtDuration(info.duration);
  els.srcResolution.textContent = `${info.width}×${info.height}`;
  els.srcCodec.textContent      = (info.videoCodec || '?').toUpperCase() +
                                  (info.hasAudio ? ` + ${info.audioCodec}` : ' (no audio)');
  els.srcSize.textContent       = fmtBytes(info.bytes);
  // Cache duration for trim hint.
  document.body.dataset.srcDuration = String(info.duration);
  updateTrimHint();
}

els.pickInput.addEventListener('click', async () => {
  const p = await window.api.pickInput();
  if (p) setInputPath(p);
});
els.pickOutput.addEventListener('click', async () => {
  const suggested = els.outputPath.value || 'output.mp4';
  const p = await window.api.pickOutput(suggested);
  if (p) setOutputPath(p);
});
// Clicking the displayed filename opens the same dialog.
els.outputDisplay.addEventListener('click', () => els.pickOutput.click());

// ---------- Drag & drop ----------
let dragDepth = 0;
function isFileDrag(e) {
  return Array.from(e.dataTransfer?.types || []).includes('Files');
}
window.addEventListener('dragenter', (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  dragDepth++;
  els.dropOverlay.classList.add('visible');
});
window.addEventListener('dragover', (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
});
window.addEventListener('dragleave', (e) => {
  if (!isFileDrag(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) els.dropOverlay.classList.remove('visible');
});
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  els.dropOverlay.classList.remove('visible');
  const files = Array.from(e.dataTransfer?.files || []);
  if (!files.length) return;
  const path = window.api.pathForFile(files[0]);
  if (path) setInputPath(path);
});

// ---------- Codec dropdown ----------
function populateCodecs(encoders) {
  els.codecSelect.innerHTML = '';
  // Keep ordering stable per CODEC_PRIORITY, only what's available.
  const ordered = CODEC_PRIORITY.filter(c => encoders.includes(c));
  for (const c of ordered) {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = CODEC_LABELS[c] || c;
    els.codecSelect.appendChild(opt);
  }
  // Restore prior choice if still available.
  const saved = localStorage.getItem('dvc.codec');
  if (saved && ordered.includes(saved)) els.codecSelect.value = saved;
  updateCodecHint();
}
els.codecSelect.addEventListener('change', () => {
  localStorage.setItem('dvc.codec', els.codecSelect.value);
  updateCodecHint();
});

function updateCodecHint() {
  const c = els.codecSelect.value;
  if (!c) { els.codecHint.textContent = 'No encoders detected.'; return; }
  if (c.startsWith('lib')) {
    els.codecHint.textContent = 'CPU encoder. Two-pass available; high quality.';
  } else if (c.includes('nvenc')) {
    els.codecHint.textContent = 'NVIDIA GPU encoder. Much faster; uses single-pass CBR.';
  } else if (c.includes('qsv')) {
    els.codecHint.textContent = 'Intel iGPU encoder. Faster than CPU; single-pass.';
  } else if (c.includes('amf')) {
    els.codecHint.textContent = 'AMD GPU encoder. Faster than CPU; single-pass.';
  }
}

// ---------- Segmented controls (mode + preset) ----------
let mode = 'fast';      // default to Fast for new HW-friendly behavior
let presetLevel = 'balanced';

document.querySelectorAll('.seg-btn[data-mode]').forEach(b => {
  b.addEventListener('click', () => {
    mode = b.dataset.mode;
    document.querySelectorAll('.seg-btn[data-mode]').forEach(x =>
      x.classList.toggle('active', x === b));
  });
});
document.querySelectorAll('.seg-btn[data-preset]').forEach(b => {
  b.addEventListener('click', () => {
    presetLevel = b.dataset.preset;
    document.querySelectorAll('.seg-btn[data-preset]').forEach(x =>
      x.classList.toggle('active', x === b));
  });
});

// ---------- Trim ----------
function parseTime(s) {
  s = (s || '').trim();
  if (!s) return null;
  // Accept "ss", "mm:ss", "hh:mm:ss", or decimals.
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
}
els.trimStart.addEventListener('input', updateTrimHint);
els.trimEnd.addEventListener('input', updateTrimHint);
els.trimClear.addEventListener('click', () => {
  els.trimStart.value = '';
  els.trimEnd.value = '';
  updateTrimHint();
});

// ---------- System resources ----------
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

// ---------- Progress + ETA ----------
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
    const remainingSrcSec = Math.max(0, durationSec - currentSec);
    const eta = remainingSrcSec / speed;
    if (Number.isFinite(eta) && eta > 0.5) info += `  ·  ETA ${fmtSec(eta)}  ·  ${speed.toFixed(2)}x`;
  }
  els.timeInfo.textContent = info;
});

// ---------- Start / cancel ----------
function setBusy(busy) {
  els.startBtn.disabled = busy;
  els.startBtn.classList.toggle('is-loading', busy);
  els.cancelBtn.disabled = !busy;
  els.progress.classList.toggle('is-active', busy);
}

async function startCompress() {
  const input = els.inputPath.value.trim();
  let output = els.outputPath.value.trim();
  if (!input) return toast('error', 'Missing input', 'Pick a video first.');
  if (!output) return toast('error', 'Missing output', 'Choose where to save.');
  const targetMb = resolveTargetMb();
  if (targetMb === null) return;

  // Auto-increment output filename if it would overwrite something.
  output = await window.api.resolveAvailable(output);
  setOutputPath(output);

  const env = await window.api.checkEnv();
  if (!env.ffmpeg || !env.ffprobe) {
    return toast('error', 'ffmpeg not found',
      'Install ffmpeg or place it at C:\\ffmpeg\\bin.');
  }

  const trimStart = parseTime(els.trimStart.value) || 0;
  const trimEnd = parseTime(els.trimEnd.value);
  if ((els.trimStart.value && Number.isNaN(trimStart)) ||
      (els.trimEnd.value && Number.isNaN(trimEnd))) {
    return toast('error', 'Invalid trim time', 'Use mm:ss, hh:mm:ss, or seconds.');
  }

  setBusy(true);
  els.progressFill.style.width = '0%';
  els.phase.textContent = 'Probing...';
  els.timeInfo.textContent = '';

  const audioKbps = TIERS[getTier()].audioKbps;
  const result = await window.api.startCompress({
    input, output, targetMb, audioKbps,
    codec: els.codecSelect.value || 'libx264',
    presetLevel,
    mode,
    trimStart,
    trimEnd: Number.isFinite(trimEnd) ? trimEnd : null,
    removeAudio: els.muteAudio.checked,
  });
  setBusy(false);

  if (result.ok) {
    els.progressFill.style.width = '100%';
    els.phase.textContent = 'Done';
    toast('success', 'Compressed!',
      `Final size: ${result.sizeMb.toFixed(2)} MB`,
      { label: 'Show in folder',
        onClick: () => window.api.revealInFolder(result.output) });
  } else {
    els.phase.textContent = 'Ready';
    if (result.error !== 'Cancelled') {
      toast('error', 'Failed', result.error);
    } else {
      toast('error', 'Cancelled', 'Compression cancelled.');
    }
  }
}

els.startBtn.addEventListener('click', startCompress);
els.cancelBtn.addEventListener('click', () => window.api.cancelCompress());
els.exportLogBtn.addEventListener('click', async () => {
  const p = await window.api.saveLog();
  if (p) toast('success', 'Log saved', p, {
    label: 'Show in folder', onClick: () => window.api.revealInFolder(p),
  });
});

// ---------- Custom MB slider + number input sync ----------
function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

function setCustomMb(value, source) {
  let n = parseFloat(value);
  if (!Number.isFinite(n) || n < 1) n = 1;
  // Number input has no upper bound (user can type higher than slider max);
  // slider clamps to its range. Only push to slider when source != 'slider'.
  if (source !== 'number') els.customMb.value = String(Math.round(n * 100) / 100);
  if (source !== 'slider') els.customMbSlider.value = String(clamp(n, 1, 500));
  els.customTierDisplay.textContent = `${els.customMb.value} MB`;
  // Repaint slider's filled track.
  const sliderPct = (clamp(n, 1, 500) - 1) / 499 * 100;
  els.customMbSlider.style.setProperty('--filled', `${sliderPct}%`);
}

els.customMbSlider.addEventListener('input', () => {
  setCustomMb(els.customMbSlider.value, 'slider');
});
els.customMb.addEventListener('input', () => {
  setCustomMb(els.customMb.value, 'number');
});
// Typing into the number input implies "I want Custom" — auto-select it.
els.customMb.addEventListener('focus', () => selectTier('custom'));

// ---------- Tier change → toggle the Custom slider row ----------
function selectTier(name) {
  const radio = document.querySelector(`input[name="tier"][value="${name}"]`);
  if (radio) radio.checked = true;
  syncCustomRow();
}
function syncCustomRow() {
  const isCustom = getTier() === 'custom';
  els.customMbRow.hidden = !isCustom;
}
document.querySelectorAll('input[name="tier"]').forEach(r =>
  r.addEventListener('change', syncCustomRow));

// Initial paint of the Custom row state and slider gradient.
setCustomMb(els.customMb.value, null);
syncCustomRow();

// ---------- Keyboard shortcuts ----------
function isTypingTarget(t) {
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!els.cancelBtn.disabled) {
      e.preventDefault();
      window.api.cancelCompress();
    }
    return;
  }
  // Ctrl+1/2/3 switch tabs even while typing in inputs.
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

// ---------- Encoders + initial env ----------
window.api.onEncoders(populateCodecs);
(async () => {
  const env = await window.api.checkEnv();
  els.versionTag.textContent = `v${env.appVersion}`;
  osIsDark = !!env.isDarkOS;
  if (document.documentElement.dataset.themeChoice === 'auto') applyTheme('auto');

  if (!env.ffmpeg || !env.ffprobe) {
    toast('error', 'ffmpeg missing', 'Install ffmpeg, then restart the app.');
  } else if (env.encoders && env.encoders.length) {
    populateCodecs(env.encoders);
  } else {
    populateCodecs(['libx264']);
  }

  // Update check (silent on failure / no update).
  const upd = await window.api.checkUpdate();
  if (upd && upd.latest) {
    toast('info', `Update available: ${upd.latest}`,
      `You're on v${upd.current}.`,
      { label: 'Open release page',
        onClick: () => window.api.openExternal(upd.url) });
  }
})();
