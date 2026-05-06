const TIERS = {
  free:   { limitMb: 10,  safetyMb: 0.5, audioKbps: 64  },
  basic:  { limitMb: 50,  safetyMb: 1.0, audioKbps: 96  },
  nitro:  { limitMb: 500, safetyMb: 5.0, audioKbps: 128 },
  custom: { limitMb: null, safetyMb: 0.5, audioKbps: 96 },
};

const els = {
  inputPath: document.getElementById('input-path'),
  outputPath: document.getElementById('output-path'),
  pickInput: document.getElementById('pick-input'),
  pickOutput: document.getElementById('pick-output'),
  customMb: document.getElementById('custom-mb'),
  startBtn: document.getElementById('start-btn'),
  cancelBtn: document.getElementById('cancel-btn'),
  progressFill: document.getElementById('progress-fill'),
  progress: document.querySelector('.progress'),
  phase: document.getElementById('phase'),
  timeInfo: document.getElementById('time-info'),
  toasts: document.getElementById('toasts'),
};

// ----- Theme handling -----
const THEME_KEY = 'dvc.theme';
const themeButtons = document.querySelectorAll('.theme-btn');
function applyTheme(name) {
  document.documentElement.dataset.theme = name;
  themeButtons.forEach(b =>
    b.classList.toggle('active', b.dataset.theme === name));
  try { localStorage.setItem(THEME_KEY, name); } catch (_) {}
}
themeButtons.forEach(b =>
  b.addEventListener('click', () => applyTheme(b.dataset.theme)));
applyTheme(localStorage.getItem(THEME_KEY) || 'midnight');

// ----- Tier state -----
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

// ----- Toasts -----
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

// ----- File pickers -----
els.pickInput.addEventListener('click', async () => {
  const p = await window.api.pickInput();
  if (!p) return;
  els.inputPath.value = p;
  if (!els.outputPath.value) {
    const dot = p.lastIndexOf('.');
    const stem = dot >= 0 ? p.slice(0, dot) : p;
    els.outputPath.value = stem + '_discord.mp4';
  }
});
els.pickOutput.addEventListener('click', async () => {
  const suggested = els.outputPath.value || 'output.mp4';
  const p = await window.api.pickOutput(suggested);
  if (p) els.outputPath.value = p;
});

// ----- Progress -----
function fmtSec(s) {
  if (!Number.isFinite(s)) return '';
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60).toString().padStart(2, '0');
  return `${m}:${sec}`;
}
window.api.onProgress(({ phase, percent, currentSec, durationSec }) => {
  els.progressFill.style.width = `${percent.toFixed(1)}%`;
  els.phase.textContent = phase;
  els.timeInfo.textContent =
    durationSec ? `${fmtSec(currentSec)} / ${fmtSec(durationSec)}` : '';
});

// ----- Start / cancel -----
function setBusy(busy) {
  els.startBtn.disabled = busy;
  els.startBtn.classList.toggle('is-loading', busy);
  els.cancelBtn.disabled = !busy;
  els.progress.classList.toggle('is-active', busy);
}

els.startBtn.addEventListener('click', async () => {
  const input = els.inputPath.value.trim();
  const output = els.outputPath.value.trim();
  if (!input) return toast('error', 'Missing input', 'Pick a video first.');
  if (!output) return toast('error', 'Missing output', 'Choose where to save.');
  const targetMb = resolveTargetMb();
  if (targetMb === null) return;

  const env = await window.api.checkEnv();
  if (!env.ffmpeg || !env.ffprobe) {
    return toast('error', 'ffmpeg not found',
      'Install ffmpeg or place it at C:\\ffmpeg\\bin.');
  }

  setBusy(true);
  els.progressFill.style.width = '0%';
  els.phase.textContent = 'Probing...';
  els.timeInfo.textContent = '';

  const audioKbps = TIERS[getTier()].audioKbps;
  const result = await window.api.startCompress({
    input, output, targetMb, audioKbps,
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
});

els.cancelBtn.addEventListener('click', () => {
  window.api.cancelCompress();
});

// ----- Auto-select Custom tier when typing in the MB field -----
els.customMb.addEventListener('focus', () => {
  document.querySelector('input[name="tier"][value="custom"]').checked = true;
});

// ----- System resources -----
const RING_CIRCUM = 263.9; // 2π·42, matches stroke-dasharray in CSS

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

// Smooth numeric tween for the big value labels.
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

// Mirror compress progress into the encoder mini-bar.
const _origOnProgress = window.api.onProgress;
window.api.onProgress(({ percent }) => {
  encBar.style.width = `${Math.max(0, Math.min(100, percent)).toFixed(1)}%`;
});

// ----- Initial environment check -----
(async () => {
  const env = await window.api.checkEnv();
  if (!env.ffmpeg || !env.ffprobe) {
    toast('error', 'ffmpeg missing',
      'Install ffmpeg, then restart the app.');
  }
})();
