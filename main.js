const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

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

  // 1. Anything on PATH.
  const onPath = process.env.PATH.split(path.delimiter)
    .map(p => path.join(p, exe))
    .find(p => p && fs.existsSync(p));
  if (onPath) return onPath;

  if (process.platform !== 'win32') return null;

  // 2. Bundled alongside the packaged app: <install>/ffmpeg/{ffmpeg,ffprobe}.exe
  //    In packaged mode app.getAppPath() returns the asar path, so derive the
  //    install dir from the .exe location instead.
  const candidates = [];
  try {
    const exeDir = path.dirname(process.execPath); // <install> dir when packaged
    candidates.push(path.join(exeDir, 'ffmpeg', exe));
  } catch (_) {}
  // 3. Common manual install location.
  candidates.push(path.join('C:\\ffmpeg\\bin', exe));

  return candidates.find(p => fs.existsSync(p)) || null;
}
const FFMPEG = findExe('ffmpeg');
const FFPROBE = findExe('ffprobe');

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
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height:format=duration',
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
        resolve({
          duration: parseFloat(j.format.duration),
          width: j.streams[0].width,
          height: j.streams[0].height,
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

function runFfmpeg(args, duration, onProgress) {
  return new Promise((resolve, reject) => {
    const p = spawn(FFMPEG, args, { windowsHide: true });
    activeProcs.push(p);
    let stderr = '';
    p.stderr.on('data', d => stderr += d.toString());
    p.stdout.on('data', d => {
      const text = d.toString();
      for (const line of text.split(/\r?\n/)) {
        const m = line.match(/^out_time_(?:ms|us)=(\d+)$/);
        if (m) {
          const seconds = parseInt(m[1], 10) / 1_000_000;
          onProgress(Math.max(0, Math.min(1, seconds / duration)), seconds);
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

async function compress({ input, output, targetMb, audioKbps }, send) {
  cancelled = false;
  const info = await probeVideo(input);
  if (!info.duration || info.duration <= 0) throw new Error('Could not read duration.');

  const totalKbps = (targetMb * 8 * 1024) / info.duration;
  const videoKbps = Math.floor(totalKbps - audioKbps);
  if (videoKbps < 100) {
    throw new Error(
      `Target size too small for this clip (${info.duration.toFixed(1)}s). ` +
      `Try a higher tier or a shorter clip.`
    );
  }

  const scaleH = pickScale(info.height, targetMb);
  const vf = scaleH ? `scale=-2:${scaleH}` : null;
  const logPrefix = path.join(
    path.dirname(output),
    path.parse(output).name + '_2pass'
  );

  const common = [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-progress', 'pipe:1', '-nostats',
    '-i', input,
    '-c:v', 'libx264',
    '-b:v', `${videoKbps}k`,
    '-preset', 'medium',
    '-pix_fmt', 'yuv420p',
  ];
  if (vf) common.push('-vf', vf);

  const nullSink = process.platform === 'win32' ? 'NUL' : '/dev/null';
  const pass1 = [
    ...common,
    '-pass', '1', '-passlogfile', logPrefix,
    '-an', '-f', 'mp4', nullSink,
  ];
  const pass2 = [
    ...common,
    '-pass', '2', '-passlogfile', logPrefix,
    '-c:a', 'aac', '-b:a', `${audioKbps}k`,
    '-movflags', '+faststart',
    output,
  ];

  send('progress', { phase: 'Pass 1 of 2', percent: 0, currentSec: 0, durationSec: info.duration });
  await runFfmpeg(pass1, info.duration, (frac, sec) => {
    send('progress', {
      phase: 'Pass 1 of 2',
      percent: frac * 50,
      currentSec: sec,
      durationSec: info.duration,
    });
  });
  if (cancelled) throw new Error('Cancelled');

  send('progress', { phase: 'Pass 2 of 2', percent: 50, currentSec: 0, durationSec: info.duration });
  await runFfmpeg(pass2, info.duration, (frac, sec) => {
    send('progress', {
      phase: 'Pass 2 of 2',
      percent: 50 + frac * 50,
      currentSec: sec,
      durationSec: info.duration,
    });
  });

  // Cleanup two-pass logs.
  for (const f of fs.readdirSync(path.dirname(output))) {
    if (f.startsWith(path.parse(output).name + '_2pass') &&
        (f.endsWith('.log') || f.endsWith('.log.mbtree'))) {
      try { fs.unlinkSync(path.join(path.dirname(output), f)); } catch (_) {}
    }
  }

  const sizeMb = fs.statSync(output).size / (1024 * 1024);
  return { sizeMb };
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
  }));

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

  ipcMain.handle('shell:reveal', (_e, p) => {
    if (p && fs.existsSync(p)) shell.showItemInFolder(p);
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
    width: 820,
    height: 760,
    minWidth: 720,
    minHeight: 640,
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
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  killActive();
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
