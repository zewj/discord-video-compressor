# Discord Video Compressor

A desktop app that re-encodes videos so they fit under Discord's upload limits. Built with Electron, runs on Windows, wraps `ffmpeg` for the actual encoding.

![themes](https://img.shields.io/badge/themes-5-8b5cf6) ![two--pass](https://img.shields.io/badge/encoding-two--pass%20H.264-38bdf8) ![installer](https://img.shields.io/badge/installer-NSIS-22c55e)

---

## What it does

Pick a video, pick which Discord tier you're on, and the app produces an MP4 sized to land just under that tier's upload cap. Encoding runs in two passes for predictable file sizes; resolution is auto-stepped down for the tightest tier so quality doesn't collapse.

### Discord tier targets

| Tier              | Cap     | App targets       | Audio  |
| ----------------- | ------- | ----------------- | ------ |
| No Nitro          | 10 MB   | 9.5 MB            | 64 kbps |
| Nitro Basic       | 50 MB   | 49 MB             | 96 kbps |
| Nitro             | 500 MB  | 495 MB            | 128 kbps |
| Custom            | any MB  | (your value − 0.5 MB) | 96 kbps |

A small safety margin is subtracted from each cap so files reliably stay under the boundary instead of landing on it.

### Auto-downscaling

For tighter targets, source videos are scaled down before encoding to preserve perceptual quality:

- 10 MB tier: max 720p
- 50 MB tier: max 1080p
- 500 MB / Custom: source resolution preserved

If the chosen target leaves less than ~100 kbps for video, the app refuses to encode and tells you to pick a higher tier or trim the clip.

---

## Features

- **Two-pass H.264** (`libx264`) encoding for accurate target sizing
- **Five themes**: Midnight, Discord, Sunset, Forest, Light — picker in the top-right, choice persists
- **Animated UI**: aurora background, staggered card entrance, hover/select animations on tier cards, sweeping shine on primary button, shimmer on the progress bar
- **Live system resources panel**: CPU ring (% + model + cores), RAM ring (used / total), encoder card (Idle / Encoding + active ffmpeg process count)
- **Toast notifications** with a "Show in folder" action when compression completes
- **Cancel** kills active ffmpeg processes and cleans up two-pass log files
- **Native Windows installer** with Start Menu + Desktop shortcuts, Add/Remove Programs entry, clean uninstaller

---

## Requirements

- **Windows 10/11 (x64)**
- **ffmpeg + ffprobe** — install via [ffmpeg.org](https://ffmpeg.org/download.html) or `winget install Gyan.FFmpeg`. The app finds them via:
  1. Anything on `PATH`
  2. Fallback: `C:\ffmpeg\bin\ffmpeg.exe` and `C:\ffmpeg\bin\ffprobe.exe`

That's it for end users. The installer bundles Electron's runtime; no Node.js needed at runtime.

### Building from source (developers)

- **Node.js 18+** (tested on 24)
- **npm** (ships with Node)
- **NSIS** (only if you want to rebuild the installer): `winget install NSIS.NSIS`

---

## Install

1. Download `DiscordVideoCompressor-Setup.exe` from the [latest release](https://github.com/zewj/discord-video-compressor/releases/latest).
2. Run it. Accept the UAC prompt.
3. Pick an install folder (defaults to `C:\Program Files\DiscordVideoCompressor`) and click through.
4. Launch via the Start Menu, Desktop shortcut, or the Finish-page checkbox.

To uninstall: Settings → Apps, or run `Uninstall.exe` from the install folder.

---

## Usage

1. Click **Browse** to pick the video to compress. The output path is suggested next to the source as `<name>_discord.mp4` — change it with **Save as** if you want.
2. Pick a **Discord tier**. Tap **Custom** to enter your own MB target.
3. Click **Compress**. The progress bar fills across both passes; status shows current second / total seconds.
4. When it's done, a toast appears with the final file size and a **Show in folder** link.

Cancel mid-encode kills the active ffmpeg process and removes its two-pass log files.

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

The packager writes `dist\Discord Video Compressor-win32-x64\Discord Video Compressor.exe` along with Electron's runtime DLLs. The installer wraps that whole folder.

---

## Project layout

```
.
├── main.js                 Electron main process: ffmpeg/ffprobe spawning,
│                           two-pass encoding pipeline, system stats sampler,
│                           IPC handlers (dialogs, compress, cancel)
├── preload.js              contextBridge — exposes a safe `window.api` to
│                           the renderer (no nodeIntegration)
├── renderer/
│   ├── index.html          UI scaffold: tier cards, progress, stats panel
│   ├── styles.css          Themes (CSS variables), aurora background,
│   │                       transitions, ring stats, toast styles
│   └── app.js              Renderer logic: theme persistence, file pickers,
│                           progress wiring, smooth numeric tweens, toasts
├── build/
│   ├── icon.ico            Multi-size app icon (16/24/32/48/64/128/256)
│   └── installer.nsi       NSIS script for the Windows installer
├── package.json            Scripts: `start`, `build`
├── Run Compressor.vbs      Console-less dev launcher (no install needed)
└── README.md
```

---

## How the encoding works

1. **Probe** — `ffprobe` reports the source's duration, width, height.
2. **Budget** — total kbps = `target_MB * 8 * 1024 / duration_seconds`. Audio is reserved (64 / 96 / 128 kbps depending on tier); the rest is the video bitrate.
3. **Pass 1** — `ffmpeg -pass 1 -an -f mp4 NUL` writes only the analysis log file.
4. **Pass 2** — `ffmpeg -pass 2 -c:a aac -b:a <audio> -movflags +faststart` writes the actual MP4, using the analysis from pass 1 to spend bits where they matter.
5. **Cleanup** — the `.log` and `.log.mbtree` files from the analysis pass are deleted.

Progress is parsed from `ffmpeg -progress pipe:1`'s `out_time_us` field and reported as a percent split 50/50 across the two passes.

---

## Security

- `nodeIntegration: false`, `contextIsolation: true`
- A minimal IPC surface exposed via `contextBridge` (`pickInput`, `pickOutput`, `startCompress`, `cancelCompress`, `revealInFolder`, `onProgress`, `onStats`, `checkEnv`)
- A strict CSP in `index.html` disallowing remote scripts/styles
- Renderer only ever sends file paths and the four tier values to main; no shell strings constructed in the renderer

---

## Tech stack

- [Electron 33](https://www.electronjs.org/) — desktop shell
- [ffmpeg](https://ffmpeg.org/) — encoding (not bundled; expected on PATH or `C:\ffmpeg\bin`)
- [@electron/packager](https://github.com/electron/packager) — produces the `.exe` folder distribution
- [NSIS](https://nsis.sourceforge.io/) — produces the single-file installer
- [png-to-ico](https://www.npmjs.com/package/png-to-ico) — multi-size `.ico` generator (build-time only)

No telemetry, no network calls — everything runs locally.

---

## License

MIT.
