const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, net } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

const APP_VERSION = require('./package.json').version;
const RELEASES_API = 'https://api.github.com/repos/zewj/discord-video-compressor/releases/latest';

// ---------- system stats sampler ----------
let lastCpu = os.cpus().map(c => ({ idle: c.times.idle, total: Object.values(c.times).reduce((a, b) => a + b, 0) }));
function sampleCpuPercent() {
  const cpus = os.cpus();
  let totalIdle = 0, totalDelta = 0;
  cpus.forEach((c, i) => {
    const idle = c.times.idle;
    const total = Object.values(c.times).reduce((a, b) => a + b, 0);
    const dIdle = idle - lastCpu[i].idle;
    const dTotal = total - lastCpu[i].total;
    totalIdle += dIdle;
    totalDelta += dTotal;
    lastCpu[i] = { idle, total };
  });
  if (totalDelta <= 0) return 0;
  return Math.max(0, Math.min(100, (1 - totalIdle / totalDelta) * 100));
}

function sampleStats() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;
  return {
    cpuPercent: sampleCpuPercent(),
    memUsed: used,
    memTotal: total,
    memPercent: (used / total) * 100,
    cpuModel: os.cpus()[0]?.model || 'CPU',
    cpuCores: os.cpus().length,
    activeFfmpeg: activeProcs.length,
  };
}

// ---------- ffmpeg discovery ----------
function findExe(name) {
  const exe = process.platform === 'win32' ? `${name}.exe` : name;

  const onPath = process.env.PATH.split(path.delimiter)
    .map(p => path.join(p, exe))
    .find(p => p && fs.existsSync(p));
  if (onPath) return onPath;

  if (process.platform !== 'win32') return null;

  const candidates = [];
  try {
    const exeDir = path.dirname(process.execPath);
    candidates.push(path.join(exeDir, 'ffmpeg', exe));
  } catch (_) {}
  candidates.push(path.join('C:\\ffmpeg\\bin', exe));
  return candidates.find(p => fs.existsSync(p)) || null;
}
const FFMPEG = findExe('ffmpeg');
const FFPROBE = findExe('ffprobe');

// ---------- encoder probe ----------
// Probes `ffmpeg -encoders` once at startup so the renderer can offer
// only encoders that actually exist on this machine.
let availableEncoders = ['libx264']; // safe default if probing fails
async function probeEncoders() {
  if (!FFMPEG) return;
  try {
    const out = await new Promise((resolve, reject) => {
      const p = spawn(FFMPEG, ['-hide_banner', '-encoders'], { windowsHide: true });
      let buf = '';
      p.stdout.on('data', d => buf += d.toString());
      p.stderr.on('data', d => buf += d.toString());
      p.on('error', reject);
      p.on('close', () => resolve(buf));
    });
    const wanted = [
      'libx264', 'libx265',
      'h264_nvenc', 'hevc_nvenc',
      'h264_amf',   'hevc_amf',
      'h264_qsv',   'hevc_qsv',
    ];
    availableEncoders = wanted.filter(name => new RegExp(`\\b${name}\\b`).test(out));
    if (!availableEncoders.length) availableEncoders = ['libx264'];
  } catch (e) {
    appendLog(`encoder probe failed: ${e.message}\n`);
  }
}

// ---------- log ring buffer (for Export Log) ----------
const LOG_LIMIT = 64 * 1024; // characters
let logBuffer = '';
function appendLog(s) {
  logBuffer += s;
  if (logBuffer.length > LOG_LIMIT) {
    logBuffer = logBuffer.slice(logBuffer.length - LOG_LIMIT);
  }
}

// ---------- compression state ----------
let activeProcs = [];
let cancelled = false;
function killActive() {
  cancelled = true;
  for (const p of activeProcs) {
    try { p.kill(); } catch (_) {}
  }
  activeProcs = [];
}

function probeVideo(input) {
  return new Promise((resolve, reject) => {
    const args = [
      '-v', 'error',
      '-show_entries', 'stream=width,height,codec_type,codec_name:format=duration,size,bit_rate',
      '-of', 'json', input,
    ];
    const p = spawn(FFPROBE, args, { windowsHide: true });
    let out = '', err = '';
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => err += d);
    p.on('close', code => {
      if (code !== 0) return reject(new Error(err || `ffprobe exited ${code}`));
      try {
        const j = JSON.parse(out);
        const v = (j.streams || []).find(s => s.codec_type === 'video');
        const a = (j.streams || []).find(s => s.codec_type === 'audio');
        if (!v) return reject(new Error('No video stream found.'));
        resolve({
          duration: parseFloat(j.format.duration),
          width: v.width,
          height: v.height,
          videoCodec: v.codec_name,
          audioCodec: a ? a.codec_name : null,
          hasAudio: !!a,
          bytes: parseInt(j.format.size || '0', 10),
          bitRate: parseInt(j.format.bit_rate || '0', 10),
        });
      } catch (e) { reject(e); }
    });
  });
}

function pickScale(height, targetMb) {
  if (targetMb <= 12 && height > 720) return 720;
  if (targetMb <= 50 && height > 1080) return 1080;
  return null;
}

// Translate "max-quality / balanced / fastest" to per-encoder preset names.
function presetFor(codec, level) {
  if (codec === 'libx264' || codec === 'libx265') {
    return { fastest: 'veryfast', balanced: 'medium', quality: 'slow' }[level];
  }
  if (codec === 'h264_nvenc' || codec === 'hevc_nvenc') {
    return { fastest: 'p1', balanced: 'p4', quality: 'p7' }[level];
  }
  if (codec === 'h264_qsv' || codec === 'hevc_qsv') {
    return { fastest: 'veryfast', balanced: 'medium', quality: 'veryslow' }[level];
  }
  if (codec === 'h264_amf' || codec === 'hevc_amf') {
    return { fastest: 'speed', balanced: 'balanced', quality: 'quality' }[level];
  }
  return null;
}

function isCpuCodec(c)   { return c === 'libx264' || c === 'libx265'; }
function isNvencCodec(c) { return c === 'h264_nvenc' || c === 'hevc_nvenc'; }
function isQsvCodec(c)   { return c === 'h264_qsv'   || c === 'hevc_qsv'; }
function isAmfCodec(c)   { return c === 'h264_amf'   || c === 'hevc_amf'; }

// Common -c:v specific args (no bitrate yet). Two-pass-vs-single-pass branching
// is added by the caller because pass-1 and pass-2 differ on -an/-c:a.
function videoCodecArgs(codec, presetLevel, videoKbps) {
  const args = ['-c:v', codec, '-b:v', `${videoKbps}k`,
                '-maxrate', `${videoKbps}k`, '-bufsize', `${Math.max(2, Math.floor(videoKbps * 2))}k`];
  const preset = presetFor(codec, presetLevel);
  if (isCpuCodec(codec)) {
    if (preset) args.push('-preset', preset);
  } else if (isNvencCodec(codec)) {
    if (preset) args.push('-preset', preset);
    args.push('-rc', 'cbr', '-tune', 'hq');
  } else if (isQsvCodec(codec)) {
    if (preset) args.push('-preset', preset);
  } else if (isAmfCodec(codec)) {
    if (preset) args.push('-quality', preset);
    args.push('-rc', 'cbr');
  }
  return args;
}

function runFfmpeg(args, duration, onProgress) {
  return new Promise((resolve, reject) => {
    appendLog(`\n$ ffmpeg ${args.map(a => /\s/.test(a) ? `"${a}"` : a).join(' ')}\n`);
    const p = spawn(FFMPEG, args, { windowsHide: true });
    activeProcs.push(p);
    let stderr = '';
    p.stderr.on('data', d => { const s = d.toString(); stderr += s; appendLog(s); });
    let lastSpeed = null;
    p.stdout.on('data', d => {
      const text = d.toString();
      for (const line of text.split(/\r?\n/)) {
        const tm = line.match(/^out_time_(?:ms|us)=(\d+)$/);
        const sp = line.match(/^speed=([\d.]+)x$/);
        if (sp) lastSpeed = parseFloat(sp[1]);
        if (tm) {
          const seconds = parseInt(tm[1], 10) / 1_000_000;
          onProgress(Math.max(0, Math.min(1, seconds / duration)), seconds, lastSpeed);
        }
      }
    });
    p.on('error', reject);
    p.on('close', code => {
      activeProcs = activeProcs.filter(x => x !== p);
      if (cancelled) return reject(new Error('Cancelled'));
      if (code !== 0) return reject(new Error(stderr || `ffmpeg exited ${code}`));
      resolve();
    });
  });
}

async function compress(opts, send) {
  const {
    input, output, targetMb,
    audioKbps, removeAudio = false,
    codec = 'libx264',
    presetLevel = 'balanced',
    mode = 'twopass',                       // 'twopass' | 'fast'
    trimStart = 0, trimEnd = null,
  } = opts;

  cancelled = false;
  const info = await probeVideo(input);
  if (!info.duration || info.duration <= 0) throw new Error('Could not read duration.');

  // Resolve trim window. Either may be null/0.
  const start = Math.max(0, Number(trimStart) || 0);
  const end = trimEnd != null && trimEnd !== '' ? Math.min(info.duration, Number(trimEnd)) : info.duration;
  if (end <= start) throw new Error('Trim end must be after trim start.');
  const effectiveDuration = end - start;

  const totalKbps = (targetMb * 8 * 1024) / effectiveDuration;
  const audioK = removeAudio ? 0 : audioKbps;
  const videoKbps = Math.floor(totalKbps - audioK);
  if (videoKbps < 100) {
    throw new Error(
      `Target size too small for this clip (${effectiveDuration.toFixed(1)}s after trim). ` +
      `Try a higher tier, trim more, or strip audio.`
    );
  }

  const scaleH = pickScale(info.height, targetMb);
  const vf = scaleH ? `scale=-2:${scaleH}` : null;

  // Two-pass only works cleanly with libx264/libx265. For HW encoders or Fast
  // mode, fall back to a single-pass CBR encode.
  const wantTwoPass = mode === 'twopass' && isCpuCodec(codec);

  // Trim args go before -i (input seek = fast) and after (output seek for accuracy).
  const inputTrim  = start > 0 ? ['-ss', String(start)] : [];
  const outputTrim = end < info.duration ? ['-to', String(effectiveDuration)] : [];

  const baseInput = [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-progress', 'pipe:1', '-nostats',
    ...inputTrim,
    '-i', input,
    ...outputTrim,
  ];

  const videoArgs = videoCodecArgs(codec, presetLevel, videoKbps);
  if (vf) videoArgs.push('-vf', vf);
  videoArgs.push('-pix_fmt', 'yuv420p');

  if (wantTwoPass) {
    const logPrefix = path.join(path.dirname(output),
                                path.parse(output).name + '_2pass');
    const nullSink = process.platform === 'win32' ? 'NUL' : '/dev/null';
    const pass1 = [
      ...baseInput, ...videoArgs,
      '-pass', '1', '-passlogfile', logPrefix,
      '-an', '-f', 'mp4', nullSink,
    ];
    const pass2Tail = removeAudio ? ['-an'] : ['-c:a', 'aac', '-b:a', `${audioKbps}k`];
    const pass2 = [
      ...baseInput, ...videoArgs,
      '-pass', '2', '-passlogfile', logPrefix,
      ...pass2Tail,
      '-movflags', '+faststart',
      output,
    ];

    send('progress', { phase: 'Pass 1 of 2', percent: 0, currentSec: 0, durationSec: effectiveDuration });
    await runFfmpeg(pass1, effectiveDuration, (frac, sec, speed) => {
      send('progress', { phase: 'Pass 1 of 2', percent: frac * 50, currentSec: sec, durationSec: effectiveDuration, speed });
    });
    if (cancelled) throw new Error('Cancelled');

    send('progress', { phase: 'Pass 2 of 2', percent: 50, currentSec: 0, durationSec: effectiveDuration });
    await runFfmpeg(pass2, effectiveDuration, (frac, sec, speed) => {
      send('progress', { phase: 'Pass 2 of 2', percent: 50 + frac * 50, currentSec: sec, durationSec: effectiveDuration, speed });
    });

    // Cleanup two-pass logs.
    for (const f of fs.readdirSync(path.dirname(output))) {
      if (f.startsWith(path.parse(output).name + '_2pass') &&
          (f.endsWith('.log') || f.endsWith('.log.mbtree'))) {
        try { fs.unlinkSync(path.join(path.dirname(output), f)); } catch (_) {}
      }
    }
  } else {
    // Single-pass.
    const audioTail = removeAudio ? ['-an'] : ['-c:a', 'aac', '-b:a', `${audioKbps}k`];
    const args = [
      ...baseInput, ...videoArgs,
      ...audioTail,
      '-movflags', '+faststart',
      output,
    ];
    const phase = isCpuCodec(codec) ? 'Encoding (1 pass)' : 'Encoding (HW accel)';
    send('progress', { phase, percent: 0, currentSec: 0, durationSec: effectiveDuration });
    await runFfmpeg(args, effectiveDuration, (frac, sec, speed) => {
      send('progress', { phase, percent: frac * 100, currentSec: sec, durationSec: effectiveDuration, speed });
    });
  }

  const sizeMb = fs.statSync(output).size / (1024 * 1024);
  return { sizeMb };
}

// ---------- update checker ----------
function compareVersions(a, b) {
  const pa = a.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

function checkForUpdate() {
  return new Promise(resolve => {
    try {
      const req = net.request({ url: RELEASES_API, redirect: 'follow' });
      req.setHeader('User-Agent', `discord-video-compressor/${APP_VERSION}`);
      req.setHeader('Accept', 'application/vnd.github+json');
      let buf = '';
      req.on('response', res => {
        res.on('data', d => buf += d.toString());
        res.on('end', () => {
          try {
            const j = JSON.parse(buf);
            if (!j.tag_name) return resolve(null);
            const latest = j.tag_name;
            if (compareVersions(latest, APP_VERSION) > 0) {
              resolve({ latest, current: APP_VERSION, url: j.html_url, name: j.name });
            } else {
              resolve(null);
            }
          } catch { resolve(null); }
        });
      });
      req.on('error', () => resolve(null));
      req.end();
    } catch { resolve(null); }
  });
}

// ---------- IPC ----------
function registerIpc(win) {
  const send = (channel, payload) => {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  };

  ipcMain.handle('env:check', () => ({
    ffmpeg: !!FFMPEG,
    ffprobe: !!FFPROBE,
    ffmpegPath: FFMPEG,
    encoders: availableEncoders,
    appVersion: APP_VERSION,
    isDarkOS: nativeTheme.shouldUseDarkColors,
  }));

  ipcMain.handle('media:probe', async (_e, p) => {
    if (!p) return null;
    try { return await probeVideo(p); }
    catch (e) { return { error: e.message }; }
  });

  ipcMain.handle('dialog:openInput', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Select a video',
      properties: ['openFile'],
      filters: [
        { name: 'Video', extensions: ['mp4', 'mkv', 'mov', 'avi', 'webm', 'flv', 'wmv', 'm4v'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('dialog:saveOutput', async (_e, suggested) => {
    const r = await dialog.showSaveDialog(win, {
      title: 'Save compressed video',
      defaultPath: suggested,
      filters: [{ name: 'MP4', extensions: ['mp4'] }],
    });
    return r.canceled ? null : r.filePath;
  });

  ipcMain.handle('dialog:saveLog', async () => {
    const r = await dialog.showSaveDialog(win, {
      title: 'Export log',
      defaultPath: `dvc-log-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`,
      filters: [{ name: 'Text', extensions: ['txt'] }],
    });
    if (r.canceled) return null;
    fs.writeFileSync(r.filePath, logBuffer || '(log is empty)\n', 'utf8');
    return r.filePath;
  });

  ipcMain.handle('shell:reveal', (_e, p) => {
    if (p && fs.existsSync(p)) shell.showItemInFolder(p);
  });

  ipcMain.handle('shell:open', (_e, url) => {
    if (url) shell.openExternal(url);
  });

  ipcMain.handle('compress:start', async (_e, opts) => {
    try {
      const { sizeMb } = await compress(opts, send);
      return { ok: true, sizeMb, output: opts.output };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  });

  ipcMain.handle('compress:cancel', () => {
    killActive();
    return true;
  });

  ipcMain.handle('update:check', () => checkForUpdate());

  // Filename auto-increment helper. Avoids overwriting an existing file by
  // appending " (1)", " (2)" etc. before the extension.
  ipcMain.handle('fs:resolveAvailable', (_e, p) => {
    if (!p) return p;
    const dir = path.dirname(p);
    const ext = path.extname(p);
    const stem = path.basename(p, ext);
    let candidate = p, n = 1;
    while (fs.existsSync(candidate)) {
      candidate = path.join(dir, `${stem} (${n})${ext}`);
      n++;
    }
    return candidate;
  });

  // Bubble OS theme changes to the renderer.
  nativeTheme.on('updated', () => {
    if (!win.isDestroyed()) {
      win.webContents.send('theme:os', { isDark: nativeTheme.shouldUseDarkColors });
    }
  });
}

// ---------- window ----------
function resolveIconPath() {
  const candidates = [
    path.join(__dirname, 'build', 'icon.ico'),
    process.resourcesPath ? path.join(process.resourcesPath, 'icon.ico') : null,
  ].filter(Boolean);
  return candidates.find(p => p && fs.existsSync(p)) || undefined;
}

function createWindow() {
  const iconPath = resolveIconPath();
  const win = new BrowserWindow({
    width: 800,
    height: 700,
    minWidth: 720,
    minHeight: 600,
    backgroundColor: '#0f1226',
    title: 'Discord Video Compressor',
    icon: iconPath,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  registerIpc(win);

  const statsTimer = setInterval(() => {
    if (win.isDestroyed()) return;
    win.webContents.send('stats', sampleStats());
  }, 1000);

  win.on('closed', () => {
    clearInterval(statsTimer);
    killActive();
  });

  // Background tasks.
  probeEncoders().then(() => {
    if (!win.isDestroyed()) {
      win.webContents.send('encoders', availableEncoders);
    }
  });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  killActive();
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
