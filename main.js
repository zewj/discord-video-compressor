const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, net, protocol, clipboard } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, spawnSync } = require('child_process');

// Lets the renderer's <video> element fetch local files without opening up
// file:// + webSecurity:false. Registered before app:ready.
protocol.registerSchemesAsPrivileged([
  { scheme: 'dvc-media', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } },
]);

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
    activeFfmpeg: totalActiveProcs(),
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

  // 2. Bundled alongside the packaged app at <install>/ffmpeg/<binary>.
  //    Works on every platform — Linux users can drop a static ffmpeg
  //    build there for a portable install without polluting PATH; the
  //    Windows installer auto-populates this path via install_ffmpeg.ps1.
  const candidates = [];
  try {
    const exeDir = path.dirname(process.execPath);
    candidates.push(path.join(exeDir, 'ffmpeg', exe));
  } catch (_) {}

  // 3. Common manual install location on Windows.
  if (process.platform === 'win32') {
    candidates.push(path.join('C:\\ffmpeg\\bin', exe));
  }

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
      // H.264
      'libx264',     'h264_nvenc',  'h264_qsv',   'h264_amf',  'h264_vaapi',
      // HEVC
      'libx265',     'hevc_nvenc',  'hevc_qsv',   'hevc_amf',  'hevc_vaapi',
      // AV1
      'libsvtav1',   'libaom-av1',  'av1_nvenc',  'av1_qsv',   'av1_amf',
      // VP9
      'libvpx-vp9',
    ];
    // Most encoder names contain a hyphen ('libaom-av1','libvpx-vp9') which
    // breaks \b word boundaries. Use a custom anchor that allows alphanum,
    // dash, and underscore around the match.
    availableEncoders = wanted.filter(name => {
      const esc = name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
      return new RegExp(`(?<![A-Za-z0-9_-])${esc}(?![A-Za-z0-9_-])`).test(out);
    });
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
// Each in-flight encode lives in its own job context. With concurrency > 1
// in the renderer queue, multiple compress() calls run simultaneously and
// each needs isolated cancel state + its own Set of child processes so a
// single Cancel doesn't accidentally kill an unrelated job.
const jobs = new Map(); // jobId -> { procs: Set<ChildProcess>, cancelled: boolean }
let nextJobSeq = 0;
let statsEnabled = true; // toggled by renderer when System tab visibility changes

function makeJobId(seed) {
  nextJobSeq++;
  return seed || `j-${Date.now().toString(36)}-${nextJobSeq}`;
}
function getJob(jobId) {
  let j = jobs.get(jobId);
  if (!j) { j = { procs: new Set(), cancelled: false }; jobs.set(jobId, j); }
  return j;
}
function cancelJob(jobId) {
  const j = jobs.get(jobId);
  if (!j) return;
  j.cancelled = true;
  for (const p of j.procs) { try { p.kill(); } catch (_) {} }
}
function cancelAllJobs() {
  for (const id of jobs.keys()) cancelJob(id);
}
function totalActiveProcs() {
  let n = 0;
  for (const j of jobs.values()) n += j.procs.size;
  return n;
}

function probeVideo(input) {
  return new Promise((resolve, reject) => {
    // -show_streams gives full per-stream metadata (codec, language tags,
    // dispositions). The renderer needs this for the audio bitrate hint
    // and the subtitle track dropdown.
    const args = ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', input];
    const p = spawn(FFPROBE, args, { windowsHide: true });
    let out = '', err = '';
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => err += d);
    p.on('close', code => {
      if (code !== 0) return reject(new Error(err || `ffprobe exited ${code}`));
      try {
        const j = JSON.parse(out);
        const all = j.streams || [];
        const v = all.find(s => s.codec_type === 'video');
        const audios = all.filter(s => s.codec_type === 'audio');
        const subs = all.filter(s => s.codec_type === 'subtitle');
        if (!v) return reject(new Error('No video stream found.'));
        const stream2tag = (s, i) => ({
          index: i,
          codec: s.codec_name,
          language: s.tags?.language || null,
          title: s.tags?.title || null,
          channels: s.channels || null,
          bitRate: parseInt(s.bit_rate || '0', 10) || null,
        });
        resolve({
          duration: parseFloat(j.format.duration),
          width: v.width,
          height: v.height,
          videoCodec: v.codec_name,
          audioCodec: audios[0]?.codec_name || null,
          hasAudio: audios.length > 0,
          audioStreams: audios.map(stream2tag),
          subtitleStreams: subs.map(stream2tag),
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

const CPU_CODECS = ['libx264','libx265','libsvtav1','libaom-av1','libvpx-vp9'];
function isCpuCodec(c)   { return CPU_CODECS.includes(c); }
function isNvencCodec(c) { return c.endsWith('_nvenc'); }
function isQsvCodec(c)   { return c.endsWith('_qsv'); }
function isAmfCodec(c)   { return c.endsWith('_amf'); }
function isVaapiCodec(c) { return c.endsWith('_vaapi'); }

// VP9 belongs in WebM; everything else (H.264, HEVC, AV1) goes in MP4.
function containerFor(codec) {
  return codec === 'libvpx-vp9' ? 'webm' : 'mp4';
}

// Translate the three logical levels (fastest / balanced / quality) into the
// preset string each encoder family expects.
function presetFor(codec, level) {
  switch (codec) {
    case 'libx264': case 'libx265':
      return { fastest: 'veryfast', balanced: 'medium', quality: 'slow' }[level];
    case 'libsvtav1':
      return { fastest: '12', balanced: '8', quality: '4' }[level];
    case 'libaom-av1':
      return { fastest: '6', balanced: '4', quality: '1' }[level];
    case 'libvpx-vp9':
      return { fastest: '8', balanced: '4', quality: '1' }[level];
    case 'h264_nvenc': case 'hevc_nvenc': case 'av1_nvenc':
      return { fastest: 'p1', balanced: 'p4', quality: 'p7' }[level];
    case 'h264_qsv': case 'hevc_qsv': case 'av1_qsv':
      return { fastest: 'veryfast', balanced: 'medium', quality: 'veryslow' }[level];
    case 'h264_amf': case 'hevc_amf': case 'av1_amf':
      return { fastest: 'speed', balanced: 'balanced', quality: 'quality' }[level];
    default:
      return null; // VAAPI has no uniform preset name
  }
}

// VAAPI needs a hardware device and an upload filter; this stays before -i.
function vaapiInputArgs(codec) {
  if (!isVaapiCodec(codec)) return [];
  // /dev/dri/renderD128 is the conventional first render node on Linux.
  // If a system has multiple GPUs, ffmpeg picks this by default too.
  return ['-vaapi_device', '/dev/dri/renderD128'];
}
function vaapiVfSuffix(codec) {
  return isVaapiCodec(codec) ? 'format=nv12,hwupload' : '';
}

// Map a 0..100 quality slider value to the encoder's quality knob.
// 100 = highest quality (lowest CRF/QP). For each codec family we use the
// idiomatic flag — CRF for libx264/265/aom/svt/vpx, CQ for nvenc, GQ for
// qsv, QP for amf/vaapi.
function qualityArgsFor(codec, quality) {
  const q = Math.max(0, Math.min(100, Number(quality) || 0));
  // Per-codec sane CRF range (low quality .. high quality).
  const ranges = {
    libx264:      { lo: 38, hi: 14, flag: '-crf' },
    libx265:      { lo: 38, hi: 16, flag: '-crf' },
    libsvtav1:    { lo: 50, hi: 20, flag: '-crf' },
    'libaom-av1': { lo: 50, hi: 18, flag: '-crf' },
    'libvpx-vp9': { lo: 50, hi: 20, flag: '-crf', extra: ['-b:v', '0'] },
    h264_nvenc:   { lo: 38, hi: 14, flag: '-cq', extra: ['-rc', 'vbr'] },
    hevc_nvenc:   { lo: 38, hi: 16, flag: '-cq', extra: ['-rc', 'vbr'] },
    av1_nvenc:    { lo: 45, hi: 20, flag: '-cq', extra: ['-rc', 'vbr'] },
    h264_qsv:     { lo: 38, hi: 14, flag: '-global_quality' },
    hevc_qsv:     { lo: 38, hi: 16, flag: '-global_quality' },
    av1_qsv:      { lo: 45, hi: 20, flag: '-global_quality' },
    h264_amf:     { lo: 38, hi: 14, flag: '-qp_i', extra: ['-rc', 'cqp'] },
    hevc_amf:     { lo: 38, hi: 16, flag: '-qp_i', extra: ['-rc', 'cqp'] },
    av1_amf:      { lo: 45, hi: 20, flag: '-qp_i', extra: ['-rc', 'cqp'] },
    h264_vaapi:   { lo: 38, hi: 14, flag: '-qp', extra: ['-rc_mode', 'CQP'] },
    hevc_vaapi:   { lo: 38, hi: 16, flag: '-qp', extra: ['-rc_mode', 'CQP'] },
  };
  const r = ranges[codec] || ranges.libx264;
  // Linear lerp from lo (q=0) to hi (q=100). Round to whole number; codecs
  // expect integer CRF/QP values.
  const v = Math.round(r.lo + (r.hi - r.lo) * (q / 100));
  const args = [r.flag, String(v), ...(r.extra || [])];
  return args;
}

// Common -c:v specific args, including bitrate targeting. Two-pass vs
// single-pass branching is added by the caller because pass-1 and pass-2
// differ on audio handling.
// Same codec/preset structure as videoCodecArgs but for CRF mode — no
// bitrate block, just preset + quality flag.
function videoCodecArgsCRF(codec, presetLevel, quality) {
  const args = ['-c:v', codec];
  const preset = presetFor(codec, presetLevel);
  switch (codec) {
    case 'libx264': case 'libx265':
    case 'libsvtav1':
      if (preset) args.push('-preset', preset);
      break;
    case 'libaom-av1':
      if (preset) args.push('-cpu-used', preset);
      args.push('-row-mt', '1', '-tiles', '2x2');
      break;
    case 'libvpx-vp9':
      if (preset) args.push('-cpu-used', preset);
      args.push('-row-mt', '1', '-deadline', 'good');
      break;
    case 'h264_nvenc': case 'hevc_nvenc': case 'av1_nvenc':
      if (preset) args.push('-preset', preset);
      args.push('-tune', 'hq');
      break;
    case 'h264_qsv': case 'hevc_qsv': case 'av1_qsv':
      if (preset) args.push('-preset', preset);
      break;
    case 'h264_amf': case 'hevc_amf': case 'av1_amf':
      if (preset) args.push('-quality', preset);
      break;
    // VAAPI: no common preset.
  }
  args.push(...qualityArgsFor(codec, quality));
  return args;
}

// Escapes a filesystem path for use inside ffmpeg's filter graph (where
// `:` separates filter options and `\` is the escape character).
function ffmpegFilterPath(p) {
  return "'" + p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'") + "'";
}

function videoCodecArgs(codec, presetLevel, videoKbps) {
  const buf = `${Math.max(2, Math.floor(videoKbps * 2))}k`;
  const rateBlock = ['-b:v', `${videoKbps}k`, '-maxrate', `${videoKbps}k`, '-bufsize', buf];
  const args = ['-c:v', codec, ...rateBlock];
  const preset = presetFor(codec, presetLevel);

  switch (codec) {
    case 'libx264': case 'libx265':
      if (preset) args.push('-preset', preset);
      break;
    case 'libsvtav1':
      if (preset) args.push('-preset', preset);
      break;
    case 'libaom-av1':
      if (preset) args.push('-cpu-used', preset);
      args.push('-row-mt', '1', '-tiles', '2x2');
      break;
    case 'libvpx-vp9':
      if (preset) args.push('-cpu-used', preset);
      args.push('-row-mt', '1', '-deadline', 'good');
      break;
    case 'h264_nvenc': case 'hevc_nvenc': case 'av1_nvenc':
      if (preset) args.push('-preset', preset);
      args.push('-rc', 'cbr', '-tune', 'hq');
      break;
    case 'h264_qsv': case 'hevc_qsv': case 'av1_qsv':
      if (preset) args.push('-preset', preset);
      break;
    case 'h264_amf': case 'hevc_amf': case 'av1_amf':
      if (preset) args.push('-quality', preset);
      args.push('-rc', 'cbr');
      break;
    case 'h264_vaapi': case 'hevc_vaapi':
      args.push('-rc_mode', 'CBR');
      break;
  }
  return args;
}

function runFfmpeg(args, duration, jobId, onProgress) {
  return new Promise((resolve, reject) => {
    const job = getJob(jobId);
    appendLog(`\n[${jobId}] $ ffmpeg ${args.map(a => /\s/.test(a) ? `"${a}"` : a).join(' ')}\n`);
    const p = spawn(FFMPEG, args, { windowsHide: true });
    job.procs.add(p);
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
      job.procs.delete(p);
      if (job.cancelled) return reject(new Error('Cancelled'));
      if (code !== 0) return reject(new Error(stderr || `ffmpeg exited ${code}`));
      resolve();
    });
  });
}

// Decide whether the source's audio codec can be remuxed straight into the
// chosen container without re-encoding. ffmpeg muxer support varies; this
// list covers the common-case codecs each muxer accepts.
function audioCompatibleWithContainer(codec, container) {
  if (!codec) return false;
  if (container === 'mp4')  return ['aac','ac3','eac3','mp3','alac','opus','flac'].includes(codec);
  if (container === 'webm') return ['opus','vorbis'].includes(codec);
  return false;
}

async function compress(opts, send) {
  let {
    input, output, targetMb,
    audioKbps, removeAudio = false, audioCopy = false,
    codec = 'libx264',
    presetLevel = 'balanced',
    mode = 'twopass',                       // 'twopass' | 'fast' | 'crf'
    trimStart = 0, trimEnd = null,
    crf = 60,
    burnSubtitles = false, subtitleTrack = 0,
    customResolution = null,                // "1280x720" or "1280:720" or null
    customFramerate = null,                 // number or null
    jobId,
  } = opts;
  jobId = makeJobId(jobId);
  // Per-progress-event payload includes jobId so multiple parallel jobs
  // can each route to their own queue row in the renderer.
  const sendProgress = (data) => send('progress', { ...data, jobId });

  const info = await probeVideo(input);
  if (!info.duration || info.duration <= 0) throw new Error('Could not read duration.');

  // Resolve trim window. Either may be null/0.
  const start = Math.max(0, Number(trimStart) || 0);
  const end = trimEnd != null && trimEnd !== '' ? Math.min(info.duration, Number(trimEnd)) : info.duration;
  if (end <= start) throw new Error('Trim end must be after trim start.');
  const effectiveDuration = end - start;

  // CRF mode skips the bitrate budget entirely; quality is fixed and the
  // resulting file size is whatever it is.
  const isCrfMode = mode === 'crf';
  const totalKbps = isCrfMode ? 0 : (targetMb * 8 * 1024) / effectiveDuration;
  const audioK = removeAudio ? 0 : audioKbps;
  const videoKbps = isCrfMode ? 0 : Math.floor(totalKbps - audioK);
  if (!isCrfMode && videoKbps < 100) {
    // Compute the smallest target that would give ~150 kbps video + audio,
    // then suggest the cheapest Discord tier that covers it. Way more
    // actionable than just "trim or pick higher tier".
    const minVideo = 150;
    const minTotalKbps = minVideo + audioK;
    const minMb = Math.ceil(minTotalKbps * effectiveDuration / (8 * 1024));
    let suggest;
    if (minMb <= 9.5)        suggest = 'No Nitro (10 MB)';
    else if (minMb <= 49)    suggest = 'Nitro Basic (50 MB)';
    else if (minMb <= 495)   suggest = 'Nitro (500 MB)';
    else                     suggest = `Custom ≥ ${minMb} MB`;
    const stripHint = audioK > 0 ? ', strip audio,' : ',';
    throw new Error(
      `Target size too small for this ${effectiveDuration.toFixed(1)}s clip. ` +
      `Need at least ~${minMb} MB. Try ${suggest}${stripHint} or trim more.`
    );
  }

  // Resolution: explicit override beats auto-downscale; auto-downscale only
  // applies when there's no custom resolution AND we're in tier-targeted mode.
  let scaleFilter = '';
  if (customResolution) {
    const m = String(customResolution).match(/^(\d+)\s*[x:×]\s*(\d+)$/);
    if (m) scaleFilter = `scale=${m[1]}:${m[2]}`;
  } else {
    const scaleH = isCrfMode ? null : pickScale(info.height, targetMb);
    if (scaleH) scaleFilter = `scale=-2:${scaleH}`;
  }
  let vfChain = scaleFilter;
  // Burn-in subtitles BEFORE any HW upload step so libass renders to CPU
  // memory and the result becomes part of the frames being sent to the
  // encoder. subtitleTrack lets the user pick if there's more than one.
  if (burnSubtitles) {
    const trackIdx = Math.max(0, parseInt(subtitleTrack, 10) || 0);
    const subFilter = `subtitles=${ffmpegFilterPath(input)}:si=${trackIdx}`;
    vfChain = vfChain ? `${subFilter},${vfChain}` : subFilter;
  }
  const vaapiSuffix = vaapiVfSuffix(codec);
  if (vaapiSuffix) vfChain = vfChain ? `${vfChain},${vaapiSuffix}` : vaapiSuffix;
  const vf = vfChain || null;

  // Custom framerate: applied as -r at output position so it overrides
  // the source rate without resampling on input.
  const fpsArgs = customFramerate ? ['-r', String(customFramerate)] : [];

  // Override the output extension if the user picked VP9 (which lives in
  // WebM rather than MP4). Doing this in main rather than the renderer
  // means it's enforced even if the renderer's sync is bypassed.
  const wantedExt = '.' + containerFor(codec);
  const curExt = path.extname(output).toLowerCase();
  if (curExt !== wantedExt) {
    const stem = curExt ? output.slice(0, -curExt.length) : output;
    output = stem + wantedExt;
  }

  // Two-pass only works cleanly with libx264/libx265 etc. (CPU codecs).
  // CRF and Fast modes are always single-pass; HW encoders silently fall
  // back to single-pass even when twopass was requested.
  const wantTwoPass = mode === 'twopass' && isCpuCodec(codec);

  // Trim args go before -i (input seek = fast) and after (output seek for accuracy).
  const inputTrim  = start > 0 ? ['-ss', String(start)] : [];
  const outputTrim = end < info.duration ? ['-to', String(effectiveDuration)] : [];

  const baseInput = [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-progress', 'pipe:1', '-nostats',
    ...vaapiInputArgs(codec),
    ...inputTrim,
    '-i', input,
    ...outputTrim,
  ];

  const videoArgs = isCrfMode
    ? videoCodecArgsCRF(codec, presetLevel, crf)
    : videoCodecArgs(codec, presetLevel, videoKbps);
  if (vf) videoArgs.push('-vf', vf);
  // VAAPI encoders consume hardware frames after hwupload; setting -pix_fmt
  // would clash with that. Other codecs all accept yuv420p as a safe 8-bit
  // baseline that maximises playback compatibility.
  if (!isVaapiCodec(codec)) videoArgs.push('-pix_fmt', 'yuv420p');

  // ---------- audio handling ----------
  const cont = containerFor(codec);
  const fallbackACodec = cont === 'webm' ? 'libopus' : 'aac';
  let audioTail;
  if (removeAudio) {
    audioTail = ['-an'];
  } else if (audioCopy && audioCompatibleWithContainer(info.audioCodec, cont)) {
    // Pass-through: no re-encode, original audio stream is remuxed.
    audioTail = ['-c:a', 'copy'];
  } else {
    audioTail = ['-c:a', fallbackACodec, '-b:a', `${audioKbps}k`];
  }
  const muxFlags = cont === 'mp4' ? ['-movflags', '+faststart'] : [];

  if (wantTwoPass) {
    const logPrefix = path.join(path.dirname(output),
                                path.parse(output).name + '_2pass');
    const nullSink = process.platform === 'win32' ? 'NUL' : '/dev/null';
    // -f null discards output without invoking a real muxer, so it's safe
    // for any codec (libvpx-vp9 / svt-av1 don't fit into an mp4 muxer).
    const pass1 = [
      ...baseInput, ...videoArgs, ...fpsArgs,
      '-pass', '1', '-passlogfile', logPrefix,
      '-an', '-f', 'null', nullSink,
    ];
    const pass2 = [
      ...baseInput, ...videoArgs, ...fpsArgs,
      '-pass', '2', '-passlogfile', logPrefix,
      ...audioTail,
      ...muxFlags,
      output,
    ];

    sendProgress({ phase: 'Pass 1 of 2', percent: 0, currentSec: 0, durationSec: effectiveDuration });
    await runFfmpeg(pass1, effectiveDuration, jobId, (frac, sec, speed) => {
      sendProgress({ phase: 'Pass 1 of 2', percent: frac * 50, currentSec: sec, durationSec: effectiveDuration, speed });
    });
    if (getJob(jobId).cancelled) throw new Error('Cancelled');

    sendProgress({ phase: 'Pass 2 of 2', percent: 50, currentSec: 0, durationSec: effectiveDuration });
    await runFfmpeg(pass2, effectiveDuration, jobId, (frac, sec, speed) => {
      sendProgress({ phase: 'Pass 2 of 2', percent: 50 + frac * 50, currentSec: sec, durationSec: effectiveDuration, speed });
    });

    // Cleanup two-pass logs.
    for (const f of fs.readdirSync(path.dirname(output))) {
      if (f.startsWith(path.parse(output).name + '_2pass') &&
          (f.endsWith('.log') || f.endsWith('.log.mbtree'))) {
        try { fs.unlinkSync(path.join(path.dirname(output), f)); } catch (_) {}
      }
    }
  } else {
    // Single-pass (Fast or CRF).
    const args = [
      ...baseInput, ...videoArgs, ...fpsArgs,
      ...audioTail,
      ...muxFlags,
      output,
    ];
    const phase = isCrfMode
      ? 'Encoding (CRF)'
      : (isCpuCodec(codec) ? 'Encoding (1 pass)' : 'Encoding (HW accel)');
    sendProgress({ phase, percent: 0, currentSec: 0, durationSec: effectiveDuration });
    await runFfmpeg(args, effectiveDuration, jobId, (frac, sec, speed) => {
      sendProgress({ phase, percent: frac * 100, currentSec: sec, durationSec: effectiveDuration, speed });
    });
  }

  const sizeMb = fs.statSync(output).size / (1024 * 1024);
  jobs.delete(jobId);
  return { sizeMb, output, jobId };
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
    platform: process.platform,
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
    // Pre-allocate the jobId so the renderer can match progress events
    // even before compress() returns.
    const jobId = makeJobId(opts.jobId);
    try {
      const r = await compress({ ...opts, jobId }, send);
      return { ok: true, sizeMb: r.sizeMb, output: r.output, jobId };
    } catch (err) {
      jobs.delete(jobId);
      return { ok: false, error: err.message || String(err), jobId };
    }
  });

  // Pass a jobId to cancel just that job; omit to cancel everything.
  ipcMain.handle('compress:cancel', (_e, jobId) => {
    if (jobId) cancelJob(jobId);
    else cancelAllJobs();
    return true;
  });

  ipcMain.handle('update:check', () => checkForUpdate());

  // Renderer toggles this when the System tab loses/gains focus so we
  // don't waste IPC bandwidth on stats nobody is watching.
  ipcMain.handle('stats:setEnabled', (_e, on) => {
    statsEnabled = !!on;
    return statsEnabled;
  });

  // Copies the produced file to the OS clipboard so the user can paste it
  // straight into a Discord chat. File-on-clipboard plumbing differs per
  // platform — see comments inline.
  ipcMain.handle('clipboard:copyFile', (_e, p) => {
    if (!p || !fs.existsSync(p)) return { ok: false, error: 'file not found' };
    try {
      if (process.platform === 'win32') {
        // PowerShell's Set-Clipboard -Path puts a CF_HDROP file list on the
        // clipboard, which Discord (and Explorer) accept on paste.
        const r = spawnSync('powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command',
           `Set-Clipboard -Path "${p.replace(/"/g, '""')}"`],
          { windowsHide: true });
        if (r.status === 0) return { ok: true, mode: 'file' };
      } else if (process.platform === 'linux') {
        const uri = 'file://' + encodeURI(p).replace(/#/g, '%23');
        // Try Wayland (wl-copy) first, then X11 (xclip).
        const wl = spawnSync('wl-copy', ['--type', 'text/uri-list'], { input: uri });
        if (wl.status === 0) return { ok: true, mode: 'file' };
        const xc = spawnSync('xclip', ['-selection', 'clipboard',
          '-t', 'text/uri-list', '-i'], { input: uri });
        if (xc.status === 0) return { ok: true, mode: 'file' };
      }
      // Fallback: copy path as text. Less convenient but always works.
      clipboard.writeText(p);
      return { ok: true, mode: 'text' };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

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
  // Prefer .ico on Windows, .png everywhere else. Both files are committed
  // and copied into resources/ by the packager via --extra-resource.
  const winFirst = process.platform === 'win32';
  const ico = ['build/icon.ico', 'icon.ico'];
  const png = ['build/icon-256.png', 'icon-256.png'];
  const order = winFirst ? [...ico, ...png] : [...png, ...ico];
  const dirs = [__dirname, process.resourcesPath].filter(Boolean);
  for (const d of dirs) {
    for (const f of order) {
      const p = path.join(d, f);
      if (fs.existsSync(p)) return p;
    }
  }
  return undefined;
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
    if (win.isDestroyed() || !statsEnabled) return;
    win.webContents.send('stats', sampleStats());
  }, 1000);

  win.on('closed', () => {
    clearInterval(statsTimer);
    cancelAllJobs();
  });

  // Background tasks.
  probeEncoders().then(() => {
    if (!win.isDestroyed()) {
      win.webContents.send('encoders', availableEncoders);
    }
  });
}

app.whenReady().then(() => {
  // dvc-media://<absolute-path> serves local files to the renderer. We
  // can't use file:// directly without disabling webSecurity; this gives
  // the <video> element on the Encoding tab a clean URL it can load.
  protocol.handle('dvc-media', (req) => {
    const url = new URL(req.url);
    let pathname = decodeURIComponent(url.pathname);
    if (process.platform === 'win32' && /^\/[a-zA-Z]:/.test(pathname)) {
      pathname = pathname.slice(1);
    }
    return net.fetch('file://' + pathname.replace(/\\/g, '/'));
  });
  createWindow();
});
app.on('window-all-closed', () => {
  killActive();
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
