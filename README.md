# YouTube Desktop

An unofficial desktop application for YouTube, built with Electron. A personal project—**free and open-source**—unaffiliated with and not owned by YouTube or Google.

## Features

### Video Playback
- **Real PiP** — True Picture-in-Picture using the Document Picture-in-Picture API: the video floats in a separate window without pausing or reloading the page.
- **Auto-PiP on minimize** — Automatically enables PiP when minimizing the main window and closes it when restoring the window.
- **SponsorBlock** — Automatically skips sponsored segments in videos (using the community database at [sponsor.ajay.app](https://sponsor.ajay.app)).
- **YouTube Ad Blocker** — Automatically mutes and clicks "Skip Ad" in both the main window and PiP mode.
- **Resume Watching** — Automatically reopens the exact video at the timestamp where you left off.
- **Recent Watch History** — Locally saves the last 25 videos; no Google login required.
- **Focus Mode** — Hides the sidebar (recommendations, comments) and displays only the video player.
- **Sleep Timer** — Automatically pauses playback after 15, 30, or 60 minutes, or when the current video ends.
- **Open video from clipboard** — Detects YouTube links in the clipboard when refocusing the app and prompts to open them.
- **Force highest quality** — Always selects the best available video and audio quality.

### Audio
- **Audio enhancement** — EQ (bass/mid/treble) and compressor via the Web Audio API to compensate for YouTube's audio compression; includes 4 presets: Balanced, Bass Boost, Vocal Clarity, and Loudness Boost. - **Select audio output device** — route audio to your chosen speaker, headphones, or DAC, bypassing the system default.
- **Audio-only mode** — hide the video and lower quality to the minimum to reduce CPU/GPU load.

### System Integration
- **Discord Rich Presence** — displays the video currently being watched, including a progress bar and a "Watch" button.
- **Media keys** — Play/Pause/Next/Prev controls via keyboard; works even when the app is running in the background.
- **Ctrl+M shortcut** — global mute/unmute; synchronizes state for the next video.
- **Enhanced Taskbar (Windows)** — control buttons on hover + progress bar overlay on the icon.
- **Desktop notifications** when a video ends.
- **Auto-update** — automatically checks for updates via `electron-updater`.
- **Export/Import configuration** — backup or transfer settings to another machine.
- **Customizable accent color**.

## Setup (development)

```bash
npm install
npm start
```

### Configuration required for full functionality

**Discord Rich Presence** (optional; enabled by default but requires a Client ID to function):
1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) → **New Application**.
2. Copy the **Application ID** and paste it into the `DISCORD_CLIENT_ID` constant at the top of `main.js`.
3. Go to the **Rich Presence → Art Assets** tab and upload 3 images with the exact key names: `youtube_logo` (large image), `play_icon`, and `pause_icon` (small images).

**Auto-update** (optional):
1. Open `package.json` → `build.publish`. 2. Replace `owner`/`repo` with your actual GitHub repository (where the `.exe` release is hosted).
3. If left unconfigured, the auto-update feature does nothing—it will not cause errors.

## Build

```bash
npm run build
```

Builds the `.exe` (NSIS installer + portable) into the `dist/` directory using `electron-builder`.

## Project Structure

```
main.js       — all main process logic + scripts injected into the YouTube page
preload.js    — secure bridge between renderer and main process (contextBridge)
package.json  — app configuration, dependencies, build config
icon.ico      — app icon
```

All custom UI elements (navigation buttons, "..." menu, Settings modal, PiP overlay, etc.) are written in vanilla JS/DOM and injected directly into `youtube.com` via `webContents.executeJavaScript()`. This process repeats every ~2 seconds and after every page navigation to ensure the UI restores itself if YouTube modifies the DOM.

## Data Storage

The app stores the following files in the `userData` directory (`%APPDATA%/youtubeapp` on Windows):

| File | Content |
|---|---|
| `user-settings.json` | All user settings |
| `resume-state.json` | Last watched video and playback timestamp |
| `watch-history.json` | History of the last 25 watched videos |
| `app-error.log` | Error logs (renderer + main process), capped at ~2MB |

No data is sent externally, except for: SponsorBlock API calls (sending the video ID to retrieve sponsor segments), Discord calls (if Rich Presence is enabled), and GitHub calls (if auto-update is enabled).

## Known Limitations

- **Exclusive audio mode** (bit-perfect WASAPI exclusive) — not feasible at the Electron/Chromium layer; requires writing a custom native addon. Planned for a future version.
- **Notifications for new videos from subscribed channels** — not implemented; requires YouTube Data API + OAuth (broad scope, deferred for later).
- **Downloading high-quality audio separately from YouTube** — not implemented, because (1) YouTube's audio track is already fixed at the highest available quality, so selecting it separately offers no improvement, and (2) extracting raw stream URLs violates YouTube's Terms of Service.
- The UI injection script relies on YouTube's current DOM structure — if YouTube changes its interface, certain features (navigation buttons, SponsorBlock selectors, autoplay toggle, etc.) may require selector updates. Check `app-error.log` if you encounter an unusual error.

## License

Open source; free to use, modify, and contribute to. This is an unofficial project and does not represent YouTube or Google.

By the way, this is the 2nd README and made using AI.
