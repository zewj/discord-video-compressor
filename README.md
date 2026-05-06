# Discord Video Compressor

A desktop app that re-encodes videos so they fit under Discord's upload limits. Built with Electron, runs on Windows, wraps `ffmpeg` for the actual encoding.

![themes](https://img.shields.io/badge/themes-6-8b5cf6) ![codecs](https://img.shields.io/badge/codecs-H.264%20%2F%20HEVC%20%2F%20NVENC%20%2F%20QSV%20%2F%20AMF-38bdf8) ![installer](https://img.shields.io/badge/installer-NSIS%20%2B%20auto--ffmpeg-22c55e)

---

## What it does

Pick a video, pick which Discord tier you're on, optionally trim/mute it, and the app produces an MP4 sized to land just under that tier's upload cap. It auto-detects every encoder ffmpeg has available — including hardware encoders on NVIDIA, Intel, and AMD GPUs — so encodes can be 3–10× faster than CPU on modern hardware.

### Discord tier targets

| Tier              | Cap     | App targets       | Audio  |
| ----------------- | ------- | ----------------- | ------ |
| No Nitro          | 10 MB   | 9.5 MB            | 64 kbps |
| Nitro Basic       | 50 MB   | 49 MB             | 96 kbps |
| Nitro             | 500 MB  | 495 MB            | 128 kbps |
| Custom            | any MB  | (your value − 0.5 MB) | 96 kbps |

A small safety margin is subtracted from each cap so files reliably stay under the boundary instead of landing on it. With audio stripped, all of the bitrate budget goes to video.

### Auto-downscaling

For tighter targets, source videos are scaled down before encoding to preserve perceptual quality:

- 10 MB tier: max 720p
- 50 MB tier: max 1080p
- 500 MB / Custom: source resolution preserved

If the chosen target leaves less than ~100 kbps for video, the app refuses to encode and tells you to pick a higher tier, trim the clip, or strip audio.

---

## Features

### Encoding
- **Hardware acceleration** — auto-probes ffmpeg's encoder list at startup and lets you choose:
  - CPU H.264 (`libx264`) and HEVC (`libx265`)
  - NVIDIA NVENC H.264 / HEVC
  - Intel QuickSync H.264 / HEVC
  - AMD AMF H.264 / HEVC
- **Two modes**:
  - **Two-pass** (CPU codecs only) — most accurate target sizing
  - **Fast** (1-pass CBR) — quicker, works with all encoders including HW
- **Quality presets**: Fastest / Balanced / Max quality. Maps to per-encoder presets (`p1..p7` for NVENC, `veryfast..veryslow` for libx264, etc.)
- **Trim**: start + end times in `mm:ss` / `hh:mm:ss` / decimal seconds. Bitrate is recomputed for the trimmed window.
- **Strip audio** checkbox — uses `-an`, reallocates the audio budget to video. Useful for very short clips.
- **Source metadata** displayed inline after picking a video: duration, resolution, codec(s), file size.

### UI / UX
- **Six themes**: Auto (follows Windows dark/light), Midnight, Discord, Sunset, Forest, Light. Persists across launches.
- **Animated UI**: aurora background, staggered card entrance, hover/select animations on tier cards, sweeping shine on primary button, shimmer on the progress bar.
- **Drag and drop** — drop a video anywhere on the window to load it.
- **Auto-incrementing output filename** — never overwrites an existing file (`name.mp4` → `name (1).mp4` etc.).
- **ETA + speed multiplier** in the status line, parsed from ffmpeg's `speed=` output.
- **Keyboard shortcuts**: `Space` to start, `Esc` to cancel, `Ctrl+L` to export the log.
- **Export log** button — saves the recent ffmpeg stderr to a text file for troubleshooting.
- **Live system resources panel**: CPU ring (% + model + cores), RAM ring (used / total), encoder card (Idle / Encoding + active ffmpeg process count).
- **Update checker** — silently checks GitHub releases on launch and shows a toast if a newer version is available.
- **Toast notifications** with action links (Show in folder, Open release page, etc.).
- **Cancel** kills active ffmpeg processes and cleans up two-pass log files.

### Distribution
- **Native Windows installer** with Start Menu + Desktop shortcuts, Add/Remove Programs entry, clean uninstaller.
- **Auto-installs ffmpeg** at install time if it's not already on the system.

---

## Requirements

- **Windows 10/11 (x64)**
- **ffmpeg + ffprobe** — handled automatically:
  - The installer detects ffmpeg on PATH or at `C:\ffmpeg\bin`.
  - If neither is present, it downloads the latest "essentials" build from gyan.dev and bundles `ffmpeg.exe` + `ffprobe.exe` into the install folder.
  - Lookup order at runtime: PATH → `<install>\ffmpeg\` → `C:\ffmpeg\bin`.
- **Internet** — only needed at install time, only when ffmpeg isn't already present.
- **Hardware acceleration (optional)** — works automatically when available:
  - **NVIDIA**: GeForce GTX 600+ / RTX (any) — driver provides `h264_nvenc` / `hevc_nvenc`.
  - **Intel**: 6th-gen Core or newer — driver provides `h264_qsv` / `hevc_qsv`.
  - **AMD**: Radeon RX series with AMF driver — provides `h264_amf` / `hevc_amf`.

### Building from source (developers)

- **Node.js 18+** (tested on 24)
- **npm** (ships with Node)
- **NSIS** (only if you want to rebuild the installer): `winget install NSIS.NSIS`

---

## Install

1. Download `DiscordVideoCompressor-Setup.exe` from the [latest release](https://github.com/zewj/discord-video-compressor/releases/latest).
2. Run it. Accept the UAC prompt.
3. Pick an install folder (defaults to `C:\Program Files\DiscordVideoCompressor`) and click through. ffmpeg downloads automatically here if you don't already have it.
4. Launch via the Start Menu, Desktop shortcut, or the Finish-page checkbox.

To uninstall: Settings → Apps, or run `Uninstall.exe` from the install folder.

---

## Usage

1. **Drop a video onto the window** or click **Browse**. The output path is suggested next to the source as `<name>_discord.mp4` and auto-incremented if a file with that name already exists.
2. Pick a **Discord tier**. Tap **Custom** to enter your own MB target.
3. Open **Encoding options** (collapsible) to:
   - Pick a codec / encoder (CPU or HW)
   - Choose mode (Two-pass / Fast)
   - Choose preset (Fastest / Balanced / Max quality)
   - Trim with start/end times in `mm:ss`
   - Toggle **Strip audio** for max video quality
4. Click **Compress** (or hit `Space`). Progress bar shows current pass + ETA + speed multiplier.
5. When done, a toast appears with the final size and a **Show in folder** link.

`Esc` cancels mid-encode. `Ctrl+L` exports the recent ffmpeg log.

---

## Building from source

```powershell
git clone https://github.com/zewj/discord-video-compressor.git
cd discord-video-compressor
npm install

# Run in development
npm start

# Package the app (folder with .exe in dist\)
npm run build

# Build the installer (writes dist\DiscordVideoCompressor-Setup.exe)
& "C:\Program Files (x86)\NSIS\makensis.exe" build\installer.nsi
```

---

## Project layout

```
.
├── main.js                 Electron main process: ffmpeg/ffprobe spawning,
│                           encoder probing, two-pass/single-pass pipeline,
│                           system stats sampler, log ring buffer,
│                           update checker, IPC handlers
├── preload.js              contextBridge — exposes a safe `window.api` to
│                           the renderer (no nodeIntegration). Includes
│                           webUtils.getPathForFile for drag-drop support.
├── renderer/
│   ├── index.html          UI scaffold: tier cards, encoding options,
│   │                       progress, stats, drag overlay, toast stack
│   ├── styles.css          Themes (CSS variables), aurora background,
│   │                       transitions, segmented controls, ring stats,
│   │                       animated drop overlay, toast styles
│   └── app.js              Renderer logic: theme persistence, drag/drop,
│                           pickers, source-info probing, codec/preset
│                           controls, trim parsing, ETA, keyboard shortcuts,
│                           update toasts, system stats display
├── build/
│   ├── icon.ico            Multi-size app icon (16/24/32/48/64/128/256)
│   ├── installer.nsi       NSIS script for the Windows installer
│   └── install_ffmpeg.ps1  Run by the installer if ffmpeg isn't found —
│                           downloads and extracts to <install>\ffmpeg\
├── package.json            Scripts: `start`, `build`
├── Run Compressor.vbs      Console-less dev launcher (no install needed)
└── README.md
```

---

## How the encoding works

1. **Probe** — `ffprobe` reports the source's duration, width, height, codecs, and file size.
2. **Trim window** — if start/end are set, the effective duration becomes `(end - start)`.
3. **Budget** — total kbps = `target_MB * 8 * 1024 / effective_duration`. If audio isn't stripped, `audio_kbps` (64 / 96 / 128 depending on tier) is reserved; the rest is the video bitrate.
4. **Encode**:
   - **Two-pass** (CPU only): pass 1 writes the analysis log; pass 2 produces the MP4 using that analysis. Most accurate sizing.
   - **Fast** (single-pass CBR): one ffmpeg invocation with `-b:v <kbps>` + `-maxrate` + `-bufsize` for predictability. Required for all HW encoders.
5. **Resolution scaling** — auto-downscales (720p / 1080p) for tighter targets to keep quality up.
6. **Cleanup** — two-pass `.log` and `.log.mbtree` files are deleted after pass 2.

Progress comes from ffmpeg's `-progress pipe:1` (`out_time_us` for elapsed, `speed=` for ETA computation).

---

## Security

- `nodeIntegration: false`, `contextIsolation: true`
- A minimal IPC surface exposed via `contextBridge`
- Strict CSP in `index.html` — no remote scripts/styles
- Renderer never builds shell strings; all paths go through `dialog.*` and `webUtils.getPathForFile`
- Update checker uses Electron's `net` module to call `api.github.com`; no credentials, no analytics

---

## Tech stack

- [Electron 33](https://www.electronjs.org/) — desktop shell
- [ffmpeg](https://ffmpeg.org/) — encoding
- [@electron/packager](https://github.com/electron/packager) — produces the `.exe` folder distribution
- [NSIS](https://nsis.sourceforge.io/) — produces the single-file installer
- [png-to-ico](https://www.npmjs.com/package/png-to-ico) — multi-size `.ico` generator (build-time only)

No telemetry, no network calls — except (a) the once-per-launch update check against GitHub's releases API, and (b) the install-time ffmpeg download from gyan.dev when needed.

---

## License

MIT.
