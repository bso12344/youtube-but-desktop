const { app, BrowserWindow, shell, Menu, Tray, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { Client: DiscordRPCClient } = require('@xhayper/discord-rpc');

const DEBUG = false;
const APP_NAME = 'YouTube';

// --- DISCORD RICH PRESENCE ---
// 1. Vào https://discord.com/developers/applications -> New Application
// 2. Copy "Application ID" dán vào đây
// 3. Vào tab "Rich Presence" > "Art Assets" và upload 2 ảnh với đúng tên key:
//    - "youtube_logo" (ảnh lớn)
//    - "play_icon", "pause_icon" (ảnh nhỏ, tuỳ chọn)
const DISCORD_CLIENT_ID = '1552667187448250510';

let rpcClient = null;
let rpcIsConnected = false;
let rpcReconnectTimer = null;
let rpcLastPayloadKey = null;
let rpcLastUpdateAt = 0;

app.setName(APP_NAME);
if (process.platform === 'win32') {
  app.setAppUserModelId('com.bso.youtubedesktop');
}

let mainWindow;
let pipWindow = null;
let tray = null;
let isQuitting = false;
let injectInterval = null;

// --- BỘ TỪ ĐIỂN ĐA NGÔN NGỮ (I18N) ---
const I18N = {
  vi: {
    pipTitle: 'Đang phát ở chế độ PiP',
    pipDesc: 'Video đang được trình chiếu trong cửa sổ thu nhỏ',
    adNotice: 'Đang có quảng cáo, đợi 1 tí',
    watchAdBtn: 'Xem quảng cáo',
    settingsPipAd: 'Tự động ẩn & tắt tiếng quảng cáo trong PiP',
    settingsTray: 'Thu xuống System Tray khi bấm nút X',
    settingsBoot: 'Khởi động cùng Windows',
    settingsNav: 'Tự động ẩn cụm nút điều hướng',
    settingsDiscord: 'Hiển thị đang xem trên Discord (Rich Presence)'
  },
  en: {
    pipTitle: 'Playing in Picture-in-Picture',
    pipDesc: 'Video is currently playing in a floating window',
    adNotice: 'Ad is playing, please wait',
    watchAdBtn: 'Watch Ad',
    settingsPipAd: 'Auto-mute & overlay ads in PiP mode',
    settingsTray: 'Minimize to System Tray on close',
    settingsBoot: 'Start on System Boot',
    settingsNav: 'Auto-hide navigation bar',
    settingsDiscord: 'Show what you are watching on Discord (Rich Presence)'
  },
  es: {
    pipTitle: 'Reproduciendo en Picture-in-Picture',
    pipDesc: 'El video se está reproduciendo en una ventana flotante',
    adNotice: 'Hay un anuncio, espera un momento',
    watchAdBtn: 'Ver anuncio',
    settingsPipAd: 'Silenciar y ocultar anuncios en PiP',
    settingsTray: 'Minimizar a la bandeja del sistema al cerrar',
    settingsBoot: 'Iniciar con Windows',
    settingsNav: 'Ocultar automáticamente la barra de navegación',
    settingsDiscord: 'Mostrar lo que ves en Discord (Rich Presence)'
  },
  fr: {
    pipTitle: 'Lecture en Picture-in-Picture',
    pipDesc: 'La vidéo est en cours de lecture dans une fenêtre flottante',
    adNotice: 'Publicité en cours, veuillez patienter',
    watchAdBtn: 'Regarder la publicité',
    settingsPipAd: 'Masquer et couper le son des pubs en PiP',
    settingsTray: 'Réduire dans la barre des tâches à la fermeture',
    settingsBoot: 'Lancer au démarrage de Windows',
    settingsNav: 'Masquer automatiquement la barre de navigation',
    settingsDiscord: 'Afficher ce que vous regardez sur Discord (Rich Presence)'
  },
  de: {
    pipTitle: 'Wird im Picture-in-Picture-Modus wiedergegeben',
    pipDesc: 'Das Video wird in einem schwebenden Fenster abgespielt',
    adNotice: 'Werbung läuft, bitte einen Moment warten',
    watchAdBtn: 'Werbung ansehen',
    settingsPipAd: 'Werbung im PiP-Modus stummschalten',
    settingsTray: 'Beim Schließen in den System Tray minimieren',
    settingsBoot: 'Mit Windows starten',
    settingsNav: 'Navigationsleiste automatisch ausblenden',
    settingsDiscord: 'Auf Discord anzeigen, was du schaust (Rich Presence)'
  },
  ja: {
    pipTitle: 'ピクチャー イン ピクチャーで再生中',
    pipDesc: '動画はフローティング ウィンドウで再生されています',
    adNotice: '広告が流れています。少々お待ちください',
    watchAdBtn: '広告を見る',
    settingsPipAd: 'PiPモードで広告を自動ミュート',
    settingsTray: '閉じる時にシステムトレイに最小化',
    settingsBoot: 'Windows起動時に実行',
    settingsNav: 'ナビゲーションバーを自動的に隠す',
    settingsDiscord: 'Discordで視聴中の動画を表示する（Rich Presence）'
  },
  ko: {
    pipTitle: 'PIP 모드로 재생 중',
    pipDesc: '동영상이 플로팅 창에서 재생 중입니다',
    adNotice: '광고가 재생 중입니다. 잠시만 기다려 주세요',
    watchAdBtn: '광고 보기',
    settingsPipAd: 'PiP 모드에서 광고 자동 음소거',
    settingsTray: '닫을 때 시스템 트레이로 최소화',
    settingsBoot: 'Windows 시작 시 자동 실행',
    settingsNav: '탐색 모음 자동 숨기기',
    settingsDiscord: 'Discord에 시청 중인 영상 표시 (Rich Presence)'
  },
  zh: {
    pipTitle: '正在画中画模式下播放',
    pipDesc: '视频正在画中画窗口中播放',
    adNotice: '正在播放广告，请稍候',
    watchAdBtn: '观看广告',
    settingsPipAd: 'PiP 画中画模式下自动静音广告',
    settingsTray: '关闭时最小化到系统托盘',
    settingsBoot: '开机自启动',
    settingsNav: '自动隐藏导航栏',
    settingsDiscord: '在 Discord 上显示正在观看的内容（Rich Presence）'
  }
};

// File lưu cấu hình người dùng
const settingsPath = path.join(app.getPath('userData'), 'user-settings.json');
let userSettings = {
  minimizeToTray: true,
  startOnBoot: false,
  autoHideNav: false,
  alwaysOnTop: false,
  pipAdMute: true, // Mặc định bật tự động ẩn/tắt tiếng QC trên PiP
  discordRPC: true // Mặc định bật Discord Rich Presence
};

// Đọc settings từ máy
try {
  if (fs.existsSync(settingsPath)) {
    userSettings = { ...userSettings, ...JSON.parse(fs.readFileSync(settingsPath, 'utf8')) };
  }
} catch (e) {
  console.error('Loi doc settings:', e);
}

function saveUserSettings(newSettings) {
  const discordWasOn = !!userSettings.discordRPC;
  userSettings = { ...userSettings, ...newSettings };
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(userSettings, null, 2));
  } catch (e) {
    console.error('Loi ghi settings:', e);
  }

  if (mainWindow) {
    mainWindow.setAlwaysOnTop(!!userSettings.alwaysOnTop);
  }
  app.setLoginItemSettings({
    openAtLogin: !!userSettings.startOnBoot,
    path: app.getPath('exe')
  });

  if (userSettings.discordRPC && !discordWasOn) {
    initDiscordRPC();
  } else if (!userSettings.discordRPC && discordWasOn) {
    destroyDiscordRPC();
  }
}

function createWindow() {
  Menu.setApplicationMenu(null);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    title: APP_NAME,
    icon: path.join(__dirname, 'icon.ico'),
    autoHideMenuBar: true,
    alwaysOnTop: userSettings.alwaysOnTop,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      devTools: DEBUG
    }
  });

  mainWindow.loadURL('https://www.youtube.com');

  if (DEBUG) {
    mainWindow.webContents.once('did-finish-load', () => {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    });
  }

  // 1. Phím tắt F5 / Ctrl+R / DevTools
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (DEBUG) return;
    const key = input.key.toLowerCase();
    if (input.key === 'F5' || ((input.control || input.meta) && key === 'r')) {
      mainWindow.webContents.reload();
      event.preventDefault();
      return;
    }
    if (
      input.key === 'F12' ||
      ((input.control || input.meta) && input.shift && (key === 'i' || key === 'j')) ||
      ((input.control || input.meta) && key === 'u')
    ) {
      event.preventDefault();
    }
  });

  mainWindow.webContents.on('context-menu', (e) => e.preventDefault());

  // 2. Thu xuống System Tray
  mainWindow.on('close', (event) => {
    if (!isQuitting && userSettings.minimizeToTray) {
      event.preventDefault();
      mainWindow.hide();
      return false;
    }
  });

  // 3. Script Tiêm UI
  const injectScript = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    const canGoBack = mainWindow.webContents.canGoBack();
    const canGoForward = mainWindow.webContents.canGoForward();

    const script = `
      (function() {
        const SVG_NS = 'http://www.w3.org/2000/svg';
        const I18N = ${JSON.stringify(I18N)};

        // --- Trạng thái Document Picture-in-Picture (PiP thật, không reload trang) ---
        let docPipVideoRef = null;
        let docPipWinRef = null;
        let docPipAdInterval = null;
        let docPipOriginalParent = null;
        let docPipOriginalNextSibling = null;

        function getLangCode() {
          const langAttr = document.documentElement.lang || 'en';
          return langAttr.split('-')[0].toLowerCase();
        }

        function getDict() {
          return I18N[getLangCode()] || I18N.en;
        }

        // --- A. TIÊU ĐỀ CỬA SỔ ---
        const titleLabels = {
          vi: { video: 'YouTube', browsingChannel: 'Đang xem kênh', lookingInPlaylist: 'Đang xem danh sách phát' },
          en: { video: 'YouTube', browsingChannel: 'Browsing channel', lookingInPlaylist: 'Looking in playlist' }
        };

        function updateTitle() {
          const currentTitle = document.title;
          const isRawYouTubeTitle = /-\\s*YouTube\\s*$/i.test(currentTitle) || currentTitle === 'YouTube';
          if (!isRawYouTubeTitle) return;

          const labels = titleLabels[getLangCode()] || titleLabels.en;
          const path = location.pathname;
          const rawTitle = (currentTitle || '').replace(/\\s*-\\s*YouTube\\s*$/i, '').trim();
          let newTitle = 'YouTube';

          if (path.startsWith('/watch')) newTitle = rawTitle ? (rawTitle + ' - ' + labels.video) : 'YouTube';
          else if (path.startsWith('/playlist')) newTitle = rawTitle ? (rawTitle + ' - ' + labels.lookingInPlaylist) : 'YouTube';
          else if (path.startsWith('/channel/') || path.startsWith('/c/') || /^\\/@/.test(path)) newTitle = rawTitle ? (rawTitle + ' - ' + labels.browsingChannel) : 'YouTube';

          if (document.title !== newTitle) document.title = newTitle;
        }

        function svgEl(tag, attrs) {
          const el = document.createElementNS(SVG_NS, tag);
          for (const k in attrs) el.setAttribute(k, attrs[k]);
          return el;
        }

        function makeIconButton(id, title, pathD, disabled) {
          const btn = document.createElement('button');
          btn.id = id;
          btn.title = title;
          btn.style.cssText = 'width:36px;height:36px;border-radius:50%;border:none;background:transparent;color:#fff;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:background 0.2s;' + (disabled ? 'opacity:0.3;' : 'opacity:1;');
          btn.disabled = !!disabled;

          const svg = svgEl('svg', { viewBox: '0 0 24 24', style: 'width:20px;height:20px;fill:#fff' });
          svg.appendChild(svgEl('path', { d: pathD }));
          btn.appendChild(svg);
          return btn;
        }

        // --- B. TẠO CỤM NÚT ĐIỀU HƯỚNG ---
        function createButtons() {
          if (document.getElementById('yt-app-nav-bar')) {
            const bBack = document.getElementById('yt-nav-back');
            const bForward = document.getElementById('yt-nav-forward');
            if (bBack) { bBack.disabled = ${!canGoBack}; bBack.style.opacity = ${!canGoBack} ? '0.3' : '1'; }
            if (bForward) { bForward.disabled = ${!canGoForward}; bForward.style.opacity = ${!canGoForward} ? '0.3' : '1'; }
            return;
          }

          const container = document.createElement('div');
          container.id = 'yt-app-nav-bar';
          container.style.cssText = 'position: fixed !important; bottom: 30px !important; right: 30px !important; display: flex !important; gap: 8px !important; z-index: 2147483647 !important; background: rgba(15, 15, 15, 0.9) !important; backdrop-filter: blur(16px) !important; padding: 6px 10px !important; border-radius: 50px !important; border: 1px solid rgba(255, 255, 255, 0.2) !important; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.7) !important; transition: opacity 0.3s;';

          const backBtn = makeIconButton('yt-nav-back', 'Back', 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z', ${!canGoBack});
          const reloadBtn = makeIconButton('yt-nav-reload', 'Reload (F5)', 'M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z', false);
          const forwardBtn = makeIconButton('yt-nav-forward', 'Forward', 'M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z', ${!canGoForward});
          const moreBtn = makeIconButton('yt-nav-more', 'More Options', 'M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z', false);

          container.appendChild(backBtn);
          container.appendChild(reloadBtn);
          container.appendChild(forwardBtn);
          container.appendChild(moreBtn);

          (document.body || document.documentElement).appendChild(container);

          backBtn.onclick = (e) => { e.stopPropagation(); window.history.back(); };
          forwardBtn.onclick = (e) => { e.stopPropagation(); window.history.forward(); };
          reloadBtn.onclick = (e) => { e.stopPropagation(); window.location.reload(); };
          moreBtn.onclick = (e) => { e.stopPropagation(); toggleMoreMenu(); };

          if (window.electronAPI) {
            window.electronAPI.getSettings().then(s => {
              if (s.autoHideNav) {
                container.style.opacity = '0.2';
                container.onmouseenter = () => container.style.opacity = '1';
                container.onmouseleave = () => container.style.opacity = '0.2';
              }
            });
          }
        }

        // --- C. POP-UP MENU KHI CLICK NÚT "..." ---
        function toggleMoreMenu() {
          let menu = document.getElementById('yt-app-more-menu');
          if (menu) {
            menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
            return;
          }

          menu = document.createElement('div');
          menu.id = 'yt-app-more-menu';
          menu.style.cssText = 'position: fixed !important; bottom: 80px !important; right: 30px !important; width: 180px !important; background: rgba(24, 24, 24, 0.95) !important; backdrop-filter: blur(16px) !important; border: 1px solid rgba(255, 255, 255, 0.15) !important; border-radius: 12px !important; box-shadow: 0 10px 30px rgba(0,0,0,0.8) !important; z-index: 2147483647 !important; padding: 6px !important; display: block; color: #fff; font-family: sans-serif; font-size: 13px;';

          function makeMenuItem(text, iconPath, onClick) {
            const item = document.createElement('div');
            item.style.cssText = 'padding: 8px 12px; display: flex; align-items: center; gap: 10px; cursor: pointer; border-radius: 8px; transition: background 0.2s;';
            item.onmouseenter = () => item.style.background = 'rgba(255, 255, 255, 0.1)';
            item.onmouseleave = () => item.style.background = 'transparent';

            const svg = svgEl('svg', { viewBox: '0 0 24 24', style: 'width:18px;height:18px;fill:#fff' });
            svg.appendChild(svgEl('path', { d: iconPath }));
            
            const span = document.createElement('span');
            span.innerText = text;

            item.appendChild(svg);
            item.appendChild(span);
            item.onclick = (e) => { e.stopPropagation(); menu.style.display = 'none'; onClick(); };
            return item;
          }

          // Item 1: Real PiP Custom Window
          // Item 1: Real PiP — ưu tiên Document Picture-in-Picture (thật, không reload/pause),
          // fallback sang cửa sổ Electron riêng (cách cũ) nếu Chromium không hỗ trợ API này.
          menu.appendChild(makeMenuItem('Real PiP', 'M19 11h-8v6h8v-6zm4 8V5c0-1.1-.9-2-2-2H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 0H3V5h18v14z', () => {
            const video = document.querySelector('video');
            if (!video) return;

            if (window.documentPictureInPicture) {
              openDocumentPip(video);
              return;
            }

            // --- Fallback cho môi trường không hỗ trợ Document PiP ---
            if (window.electronAPI) {
              const wasPaused = video.paused;
              const currentTime = video.currentTime || 0;
              window.electronAPI.openCustomPip({ url: window.location.href, currentTime }).then((result) => {
                if (result && result.ok) {
                  if (!wasPaused) video.pause();
                  showMainWindowPipOverlay();
                } else {
                  console.warn('Real PiP (fallback) that bai, giu video goc tiep tuc phat:', result && result.error);
                }
              }).catch((err) => console.warn('Real PiP loi IPC:', err));
            }
          }));

          // Item 2: Always on Top
          menu.appendChild(makeMenuItem('Ghim màn hình', 'M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z', () => {
            if (window.electronAPI) window.electronAPI.toggleAlwaysOnTop();
          }));

          // Item 3: Settings
          menu.appendChild(makeMenuItem('Cài đặt App', 'M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z', () => {
            openSettingsModal();
          }));

          (document.body || document.documentElement).appendChild(menu);
        }

        function hideMainWindowPipOverlay() {
          const overlay = document.getElementById('yt-app-main-pip-overlay');
          if (overlay) overlay.style.display = 'none';
        }

        // --- REAL PiP THẬT: dùng Document Picture-in-Picture API ---
        // Di chuyển thẳng node <video> đang phát sang 1 cửa sổ nổi luôn-trên-cùng
        // do chính Chromium quản lý -> KHÔNG pause, KHÔNG reload trang,
        // KHÔNG bị overlay "Playing in picture-in-picture" (đó là overlay của
        // requestPictureInPicture() kiểu cũ, không dùng ở đây).
        async function openDocumentPip(video) {
          if (docPipWinRef && !docPipWinRef.closed) {
            docPipWinRef.focus();
            return;
          }

          try {
            const pipWin = await window.documentPictureInPicture.requestWindow({ width: 480, height: 270 });
            docPipWinRef = pipWin;
            docPipVideoRef = video;
            docPipOriginalParent = video.parentNode;
            docPipOriginalNextSibling = video.nextSibling;

            pipWin.document.title = 'YouTube Desktop';

            const style = pipWin.document.createElement('style');
            style.textContent = \`
              html, body { margin:0; padding:0; width:100%; height:100%; background:#000; overflow:hidden; }
              #pip-video-wrap { position:relative; width:100%; height:100%; }
              #pip-video-wrap video { width:100% !important; height:100% !important; object-fit:contain; background:#000; }
              #yt-pip-ad-overlay {
                position:absolute; top:0; left:0; width:100%; height:100%;
                background:rgba(10,10,10,0.92); backdrop-filter: blur(12px);
                display:none; flex-direction:column; align-items:center; justify-content:center;
                color:#fff; font-family: Roboto, Arial, sans-serif; text-align:center;
                padding:16px; box-sizing:border-box; z-index: 999;
              }
              #yt-pip-watch-ad-btn {
                margin-top:12px; padding:8px 16px; background:rgba(255,255,255,0.2);
                border:1px solid rgba(255,255,255,0.4); color:#fff; border-radius:20px;
                font-size:12px; font-weight:bold; cursor:pointer;
                opacity:0; transform:translateY(6px); transition: all .25s ease;
              }
              #yt-pip-ad-overlay:hover #yt-pip-watch-ad-btn { opacity:1; transform:translateY(0); }
              #yt-pip-watch-ad-btn:hover { background: rgba(255,0,0,.8); border-color:#ff0000; }
            \`;
            pipWin.document.head.appendChild(style);

            const wrap = pipWin.document.createElement('div');
            wrap.id = 'pip-video-wrap';
            pipWin.document.body.appendChild(wrap);

            video.controls = true; // hiện control mặc định của trình duyệt (play/pause/tua/volume) trong PiP
            wrap.appendChild(video); // DI CHUYỂN video thật — không tạo bản sao, không pause, không mất currentTime

            const dict = getDict();
            const adOverlay = pipWin.document.createElement('div');
            adOverlay.id = 'yt-pip-ad-overlay';
            adOverlay.innerHTML = '<div style="font-size:13px;font-weight:600;">' + dict.adNotice + '</div>' +
              '<button id="yt-pip-watch-ad-btn">' + dict.watchAdBtn + '</button>';
            wrap.appendChild(adOverlay);

            let userBypassedAd = false;
            adOverlay.querySelector('#yt-pip-watch-ad-btn').onclick = (e) => {
              e.stopPropagation();
              userBypassedAd = true;
              adOverlay.style.display = 'none';
              video.muted = false;
            };

            let pipAdMuteEnabled = true;
            if (window.electronAPI) {
              try { pipAdMuteEnabled = !!(await window.electronAPI.getSettings()).pipAdMute; } catch (e) {}
            }

            // Vẫn dò quảng cáo trên #movie_player của cửa sổ chính vì đó là nơi
            // YouTube gắn class ad-showing/ad-interrupting, video tag di chuyển
            // sang PiP vẫn là CÙNG 1 element nên logic mute/overlay áp lên nó vẫn đúng.
            docPipAdInterval = setInterval(() => {
              if (!pipAdMuteEnabled) return;
              const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
              const isAd = player && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'));
              if (isAd) {
                if (!userBypassedAd) {
                  video.muted = true;
                  adOverlay.style.display = 'flex';
                }
              } else {
                userBypassedAd = false;
                adOverlay.style.display = 'none';
              }
            }, 500);

            showMainWindowPipOverlay();

            // Người dùng đóng cửa sổ PiP (nút X do Chromium vẽ) -> trả video về chỗ cũ
            pipWin.addEventListener('pagehide', () => closeDocumentPip());
          } catch (err) {
            console.warn('Khong the mo Document PiP:', err);
          }
        }

        function closeDocumentPip() {
          if (docPipAdInterval) { clearInterval(docPipAdInterval); docPipAdInterval = null; }

          if (docPipVideoRef && docPipOriginalParent) {
            docPipOriginalParent.insertBefore(docPipVideoRef, docPipOriginalNextSibling || null);
            docPipVideoRef.controls = false; // trả lại UI custom của YouTube, tắt control mặc định trình duyệt
          }

          docPipVideoRef = null;
          docPipOriginalParent = null;
          docPipOriginalNextSibling = null;
          docPipWinRef = null;

          hideMainWindowPipOverlay();
        }


        function showMainWindowPipOverlay() {
          let overlay = document.getElementById('yt-app-main-pip-overlay');
          const dict = getDict();

          if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'yt-app-main-pip-overlay';
            overlay.style.cssText = 'position: absolute !important; top: 0 !important; left: 0 !important; width: 100% !important; height: 100% !important; background: rgba(12, 12, 12, 0.95) !important; backdrop-filter: blur(20px) !important; z-index: 9999 !important; display: flex !important; flex-direction: column !important; align-items: center !important; justify-content: center !important; color: #fff !important; font-family: Roboto, Arial, sans-serif !important; gap: 12px !important;';

            const iconWrap = document.createElement('div');
            iconWrap.style.cssText = 'width:64px;height:64px;border-radius:50%;background:rgba(255,0,0,0.15);display:flex;align-items:center;justify-content:center;border:1px solid rgba(255,0,0,0.3);';
            iconWrap.innerHTML = '<svg viewBox="0 0 24 24" style="width:32px;height:32px;fill:#ff0000"><path d="M19 11h-8v6h8v-6zm4 8V5c0-1.1-.9-2-2-2H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 0H3V5h18v14z"/></svg>';

            const titleEl = document.createElement('div');
            titleEl.style.cssText = 'font-size: 18px; font-weight: bold; color: #fff;';
            titleEl.innerText = dict.pipTitle;

            const descEl = document.createElement('div');
            descEl.style.cssText = 'font-size: 13px; color: #aaa; text-align: center; max-width: 80%;';
            descEl.innerText = dict.pipDesc;

            overlay.appendChild(iconWrap);
            overlay.appendChild(titleEl);
            overlay.appendChild(descEl);

            const closeBtn = document.createElement('button');
            closeBtn.innerText = '✕';
            closeBtn.title = 'Đóng PiP';
            closeBtn.style.cssText = 'margin-top:8px;width:32px;height:32px;border-radius:50%;border:1px solid rgba(255,255,255,0.3);background:rgba(255,255,255,0.08);color:#fff;cursor:pointer;font-size:14px;';
            closeBtn.onclick = (e) => {
              e.stopPropagation();
              if (docPipWinRef && !docPipWinRef.closed) {
                docPipWinRef.close(); // trigger 'pagehide' -> closeDocumentPip() tự trả video về
              } else {
                overlay.style.display = 'none';
              }
            };
            overlay.appendChild(closeBtn);

            const playerContainer = document.querySelector('#movie_player') || document.body;
            playerContainer.style.position = 'relative';
            playerContainer.appendChild(overlay);
          } else {
            overlay.style.display = 'flex';
          }
        }

        // --- D. BẢNG SETTINGS MODAL ---
        function openSettingsModal() {
          let modal = document.getElementById('yt-app-settings-modal');
          if (modal) { modal.style.display = 'flex'; return; }

          const dict = getDict();
          modal = document.createElement('div');
          modal.id = 'yt-app-settings-modal';
          modal.style.cssText = 'position: fixed !important; top:0; left:0; width:100vw; height:100vh; background: rgba(0,0,0,0.7) !important; backdrop-filter: blur(8px) !important; z-index: 2147483647 !important; display: flex; align-items: center; justify-content: center; font-family: sans-serif; color: #fff;';

          const box = document.createElement('div');
          box.style.cssText = 'width: 440px; background: #1f1f1f; border: 1px solid rgba(255,255,255,0.15); border-radius: 16px; padding: 24px; box-shadow: 0 20px 50px rgba(0,0,0,0.9);';

          const title = document.createElement('h2');
          title.innerText = 'Cài đặt YouTube Desktop';
          title.style.cssText = 'margin: 0 0 20px 0; font-size: 18px; color: #ff0000; display: flex; justify-content: space-between; align-items: center;';

          const content = document.createElement('div');
          content.style.cssText = 'display: flex; flex-direction: column; gap: 14px; font-size: 14px;';

          function createCheckbox(label, key, settings) {
            const wrap = document.createElement('label');
            wrap.style.cssText = 'display: flex; align-items: center; gap: 10px; cursor: pointer; user-select: none;';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.checked = !!settings[key];
            input.style.cssText = 'width: 16px; height: 16px; cursor: pointer; accent-color: #ff0000;';
            input.onchange = () => {
              settings[key] = input.checked;
              if (window.electronAPI) window.electronAPI.saveSettings(settings);
            };
            const span = document.createElement('span');
            span.innerText = label;
            wrap.appendChild(input);
            wrap.appendChild(span);
            return wrap;
          }

          if (window.electronAPI) {
            window.electronAPI.getSettings().then(s => {
              content.appendChild(createCheckbox(dict.settingsTray, 'minimizeToTray', s));
              content.appendChild(createCheckbox(dict.settingsBoot, 'startOnBoot', s));
              content.appendChild(createCheckbox(dict.settingsNav, 'autoHideNav', s));
              content.appendChild(createCheckbox(dict.settingsPipAd, 'pipAdMute', s));
              content.appendChild(createCheckbox(dict.settingsDiscord, 'discordRPC', s));

              // Phần About
              const aboutBox = document.createElement('div');
              aboutBox.style.cssText = 'margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1); font-size: 12px; color: #aaa; display: flex; justify-content: space-between; align-items: center;';
              aboutBox.innerText = 'Phiên bản 1.0.0 (Open-Source)';

              const ghBtn = document.createElement('button');
              ghBtn.innerText = 'GitHub Repo';
              ghBtn.style.cssText = 'background: #333; color: #fff; border: 1px solid #555; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px;';
              ghBtn.onclick = () => window.electronAPI.openExternal('https://github.com/bso12344/youtube-but-desktop');

              aboutBox.appendChild(ghBtn);
              content.appendChild(aboutBox);
            });
          }

          const closeBtn = document.createElement('button');
          closeBtn.innerText = 'Đóng';
          closeBtn.style.cssText = 'margin-top: 20px; width: 100%; padding: 10px; background: #ff0000; color: #fff; border: none; border-radius: 8px; font-weight: bold; cursor: pointer;';
          closeBtn.onclick = () => modal.style.display = 'none';

          box.appendChild(title);
          box.appendChild(content);
          box.appendChild(closeBtn);
          modal.appendChild(box);
          (document.body || document.documentElement).appendChild(modal);
        }

        // --- E. MIỄN TRỪ TRÁCH NHIỆM ---
        function createDisclaimer() {
          if (document.getElementById('custom-app-disclaimer')) return;
          const targetNode = document.querySelector('#sections') || document.querySelector('#guide-inner-content') || document.body;
          if (targetNode) {
            const disclaimerEl = document.createElement('div');
            disclaimerEl.id = 'custom-app-disclaimer';
            disclaimerEl.innerText = 'Ứng dụng này là dự án cá nhân, không liên quan và không thuộc sở hữu của YouTube hay Google.';
            disclaimerEl.setAttribute('style', 'padding: 12px 16px !important; margin: 10px !important; font-size: 11px !important; font-weight: 700 !important; color: #909090 !important; border-top: 1px solid rgba(255, 255, 255, 0.1) !important;');
            targetNode.appendChild(disclaimerEl);
          }
        }

        // --- DISCORD RICH PRESENCE: thu thập thông tin video hiện tại ---
        function getYtVideoInfo() {
          const isWatchPage = location.pathname.startsWith('/watch');
          const video = document.querySelector('video');

          if (!isWatchPage || !video) {
            return { page: 'browse', url: location.href };
          }

          const titleEl = document.querySelector('h1.ytd-watch-metadata yt-formatted-string')
            || document.querySelector('h1.ytd-watch-metadata')
            || document.querySelector('#title h1');
          const channelEl = document.querySelector('#channel-name a')
            || document.querySelector('ytd-channel-name a')
            || document.querySelector('#upload-info ytd-channel-name a');

          const rawTitle = titleEl ? titleEl.textContent.trim() : (document.title || '').replace(/\\s*-\\s*YouTube\\s*$/i, '').trim();

          return {
            page: 'watch',
            title: rawTitle || 'YouTube',
            channelName: channelEl ? channelEl.textContent.trim() : '',
            url: location.href,
            isPlaying: !video.paused && !video.ended,
            currentTime: video.currentTime || 0,
            duration: video.duration || 0
          };
        }

        function sendDiscordPresence() {
          if (window.electronAPI && window.electronAPI.updateDiscordPresence) {
            try { window.electronAPI.updateDiscordPresence(getYtVideoInfo()); } catch (e) {}
          }
        }

        function runAll() {
          try { updateTitle(); } catch(e){}
          try { createButtons(); } catch(e){}
          try { createDisclaimer(); } catch(e){}
          try { sendDiscordPresence(); } catch(e){}
        }

        runAll();
        if (!window.ytUIObserver) {
          window.ytUIObserver = new MutationObserver(runAll);
          window.ytUIObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });
        }
      })();
    `;

    mainWindow.webContents.executeJavaScript(script).catch(() => {});
  };

  mainWindow.webContents.on('dom-ready', injectScript);
  mainWindow.webContents.on('did-finish-load', injectScript);
  mainWindow.webContents.on('did-navigate-in-page', injectScript);

  if (injectInterval) clearInterval(injectInterval);
  injectInterval = setInterval(injectScript, 2000);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!isYouTubeUrl(url)) { shell.openExternal(url); return { action: 'deny' }; }
    return { action: 'allow' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isYouTubeUrl(url)) { event.preventDefault(); shell.openExternal(resolveRedirectTarget(url)); }
  });

  mainWindow.webContents.on('will-redirect', (event, url) => {
    if (!isYouTubeUrl(url)) { event.preventDefault(); shell.openExternal(resolveRedirectTarget(url)); }
  });

  mainWindow.on('closed', () => {
    if (injectInterval) clearInterval(injectInterval);
    mainWindow = null;
  });
}

function resolveRedirectTarget(url) {
  try {
    const parsed = new URL(url);
    if (parsed.pathname.toLowerCase() === '/redirect') {
      const q = parsed.searchParams.get('q');
      if (q) return decodeURIComponent(q);
    }
  } catch (e) {}
  return url;
}

function isYouTubeUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host === 'studio.youtube.com') return false;
    if (host !== 'www.youtube.com' && host !== 'youtube.com' && host !== 'm.youtube.com') {
      return host.endsWith('.googlevideo.com') || host.endsWith('.accounts.google.com');
    }
    return true;
  } catch (e) {
    return false;
  }
}

// --- DISCORD RICH PRESENCE ---
function initDiscordRPC() {
  if (!userSettings.discordRPC) return;
  if (!DISCORD_CLIENT_ID || DISCORD_CLIENT_ID === 'DAN_CLIENT_ID_CUA_BAN_VAO_DAY') {
    console.warn('Discord RPC: chua dien DISCORD_CLIENT_ID, bo qua.');
    return;
  }
  if (rpcClient) return; // đã khởi tạo rồi

  rpcClient = new DiscordRPCClient({ clientId: DISCORD_CLIENT_ID });

  rpcClient.on('ready', () => {
    rpcIsConnected = true;
    if (rpcReconnectTimer) { clearTimeout(rpcReconnectTimer); rpcReconnectTimer = null; }
  });

  rpcClient.on('disconnected', () => {
    rpcIsConnected = false;
    scheduleDiscordReconnect();
  });

  rpcClient.login().catch((err) => {
    // Discord không chạy trên máy -> im lặng bỏ qua, thử lại sau
    rpcIsConnected = false;
    scheduleDiscordReconnect();
  });
}

function scheduleDiscordReconnect() {
  if (rpcReconnectTimer) return;
  rpcReconnectTimer = setTimeout(() => {
    rpcReconnectTimer = null;
    rpcClient = null; // tạo client mới cho lần thử tiếp theo
    initDiscordRPC();
  }, 15000);
}

function destroyDiscordRPC() {
  if (rpcReconnectTimer) { clearTimeout(rpcReconnectTimer); rpcReconnectTimer = null; }
  if (rpcClient) {
    try { rpcClient.destroy(); } catch (e) {}
    rpcClient = null;
  }
  rpcIsConnected = false;
  rpcLastPayloadKey = null;
}

// data đến từ script inject trong trang: { page: 'watch'|'browse', title, channelName, url, isPlaying, currentTime, duration }
function updateDiscordActivity(data) {
  if (!userSettings.discordRPC || !rpcClient || !rpcIsConnected) return;
  if (!data) return;

  const now = Date.now();
  let activity;

  if (data.page === 'watch' && data.title) {
    const isPlaying = !!data.isPlaying;
    const currentTime = data.currentTime || 0;
    const duration = data.duration || 0;

    activity = {
      details: data.title.slice(0, 128),
      state: (data.channelName ? data.channelName : 'YouTube').slice(0, 128),
      largeImageKey: 'youtube_logo',
      largeImageText: 'YouTube Desktop',
      smallImageKey: isPlaying ? 'play_icon' : 'pause_icon',
      smallImageText: isPlaying ? 'Đang phát' : 'Đã tạm dừng',
      instance: false
    };

    if (isPlaying && duration > 0) {
      activity.startTimestamp = Math.floor(now - currentTime * 1000);
      activity.endTimestamp = Math.floor(now + (duration - currentTime) * 1000);
    } else if (isPlaying) {
      activity.startTimestamp = Math.floor(now - currentTime * 1000);
    }

    if (data.url) {
      activity.buttons = [{ label: 'Xem trên YouTube', url: data.url }];
    }
  } else {
    activity = {
      details: 'Đang duyệt YouTube',
      largeImageKey: 'youtube_logo',
      largeImageText: 'YouTube Desktop',
      instance: false
    };
  }

  // Chống spam: chỉ gọi lại API khi nội dung thật sự đổi (bỏ qua currentTime lặt vặt),
  // hoặc đã quá 15s kể từ lần gửi trước (Discord giới hạn tần suất cập nhật).
  const compareKey = JSON.stringify({
    d: activity.details,
    s: activity.state,
    p: data.isPlaying,
    b: activity.buttons
  });

  if (compareKey === rpcLastPayloadKey && now - rpcLastUpdateAt < 15000) return;

  rpcLastPayloadKey = compareKey;
  rpcLastUpdateAt = now;

  rpcClient.user?.setActivity(activity).catch((err) => {
    console.warn('Discord RPC: cap nhat activity that bai:', err.message);
  });
}


ipcMain.handle('toggle-always-on-top', () => {
  if (mainWindow) {
    const state = !mainWindow.isAlwaysOnTop();
    mainWindow.setAlwaysOnTop(state);
    saveUserSettings({ alwaysOnTop: state });
    return state;
  }
  return false;
});

ipcMain.handle('get-settings', () => userSettings);
ipcMain.handle('save-settings', (event, newSettings) => {
  saveUserSettings(newSettings);
  return userSettings;
});
ipcMain.on('open-external', (event, url) => shell.openExternal(url));
ipcMain.on('discord-presence-update', (event, data) => updateDiscordActivity(data));

// --- XỬ LÝ CỬA SỔ FLOATING PIP CỦA ELECTRON ---
ipcMain.handle('open-custom-pip', async (event, { url, currentTime }) => {
  if (pipWindow && !pipWindow.isDestroyed()) {
    pipWindow.focus();
    return { ok: true };
  }

  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  const win = new BrowserWindow({
    width: 480,
    height: 270,
    x: width - 500,
    y: height - 290,
    frame: false,             // Tắt khung OS (Mất hoàn toàn chữ youtube.com)
    alwaysOnTop: true,        // Ghim trên cùng
    skipTaskbar: true,        // Không làm rác Taskbar
    resizable: true,
    show: false,              // Chỉ show() khi đã chắc chắn load xong
    backgroundColor: '#000000',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  let pipUrl = url;
  if (currentTime && currentTime > 0) {
    const timeSec = Math.floor(currentTime);
    pipUrl = url.includes('?') ? `${url}&t=${timeSec}s` : `${url}?t=${timeSec}s`;
  }

  try {
    // loadURL() trả về Promise: reject nếu load thất bại (mất mạng, bị chặn, ...)
    await win.loadURL(pipUrl);
  } catch (err) {
    console.error('Real PiP: load that bai:', err.message);
    if (!win.isDestroyed()) win.destroy();
    return { ok: false, error: err.message };
  }

  // Nếu người dùng bấm quá nhanh 2 lần / đóng cửa sổ trong lúc đang load
  if (win.isDestroyed()) {
    return { ok: false, error: 'window-destroyed' };
  }

  pipWindow = win;
  pipWindow.show();
  pipWindow.setAlwaysOnTop(true, 'screen-saver'); // đảm bảo luôn nổi trên cùng, kể cả khi main window cũng always-on-top

  {
    const pipAdMuteEnabled = !!userSettings.pipAdMute;

    const pipInitScript = `
      (function() {
        const I18N = ${JSON.stringify(I18N)};
        const lang = (document.documentElement.lang || 'en').split('-')[0].toLowerCase();
        const dict = I18N[lang] || I18N.en;

        // 1. Dọn dẹp giao diện YouTube trên PiP
        const style = document.createElement('style');
        style.textContent = \`
          #masthead-container, #page-manager ytd-watch-flexy > #columns > #secondary,
          #comments, #below, ytd-merch-shelf-renderer, #chat, #description,
          #yt-app-nav-bar, .ytp-chrome-top, .ytp-show-cards-button { display: none !important; }
          
          ytd-watch-flexy { padding: 0 !important; margin: 0 !important; }
          #player-theater-container, #player-container, #ytd-player, #container.ytd-player, #movie_player {
            width: 100vw !important;
            height: 100vh !important;
            max-height: 100vh !important;
            position: absolute !important;
            top: 0 !important; left: 0 !important;
          }
          .html5-video-player { width: 100% !important; height: 100% !important; }
          body, html { overflow: hidden !important; background: #000 !important; margin: 0 !important; padding: 0 !important; }

          /* Style Overlay Quảng Cáo trong PiP */
          #yt-pip-ad-overlay {
            position: absolute;
            top: 0; left: 0; width: 100%; height: 100%;
            background: rgba(10, 10, 10, 0.92);
            backdrop-filter: blur(12px);
            z-index: 2147483647;
            display: none;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            color: #fff;
            font-family: Roboto, Arial, sans-serif;
            padding: 16px;
            box-sizing: border-box;
            text-align: center;
            user-select: none;
          }

          #yt-pip-watch-ad-btn {
            margin-top: 12px;
            padding: 8px 16px;
            background: rgba(255, 255, 255, 0.2);
            border: 1px solid rgba(255, 255, 255, 0.4);
            color: #fff;
            border-radius: 20px;
            font-size: 12px;
            font-weight: bold;
            cursor: pointer;
            opacity: 0;
            transform: translateY(6px);
            transition: all 0.25s ease;
            pointer-events: auto;
          }

          /* Hiện nút Xem quảng cáo khi rê chuột (Hover) */
          #yt-pip-ad-overlay:hover #yt-pip-watch-ad-btn {
            opacity: 1;
            transform: translateY(0);
          }
          #yt-pip-watch-ad-btn:hover {
            background: rgba(255, 0, 0, 0.8);
            border-color: #ff0000;
          }
        \`;
        document.head.appendChild(style);

        // 2. Tạo DOM Overlay Quảng cáo
        let adOverlay = document.getElementById('yt-pip-ad-overlay');
        if (!adOverlay) {
          adOverlay = document.createElement('div');
          adOverlay.id = 'yt-pip-ad-overlay';

          const textDiv = document.createElement('div');
          textDiv.style.cssText = 'font-size: 13px; font-weight: 600; color: #f1f1f1; display: flex; align-items: center; gap: 8px;';
          textDiv.innerHTML = \`<svg viewBox="0 0 24 24" style="width:18px;height:18px;fill:#ff4e4e"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/></svg> <span>\${dict.adNotice}</span>\`;

          const watchBtn = document.createElement('button');
          watchBtn.id = 'yt-pip-watch-ad-btn';
          watchBtn.innerText = dict.watchAdBtn;

          adOverlay.appendChild(textDiv);
          adOverlay.appendChild(watchBtn);

          const playerContainer = document.querySelector('#movie_player') || document.body;
          playerContainer.appendChild(adOverlay);

          let userBypassedAd = false;

          watchBtn.onclick = (e) => {
            e.stopPropagation();
            userBypassedAd = true;
            adOverlay.style.display = 'none';
            const video = document.querySelector('video');
            if (video) video.muted = false;
          };

          // Vòng lặp kiểm tra trạng thái Quảng Cáo
          const pipAdMuteEnabled = ${pipAdMuteEnabled};
          setInterval(() => {
            if (!pipAdMuteEnabled) return;

            const player = document.getElementById('movie_player') || document.querySelector('.html5-video-player');
            const video = document.querySelector('video');
            const isAd = player && (player.classList.contains('ad-showing') || player.classList.contains('ad-interrupting'));

            if (isAd) {
              if (!userBypassedAd) {
                if (video) video.muted = true;
                adOverlay.style.display = 'flex';
              }
            } else {
              userBypassedAd = false;
              adOverlay.style.display = 'none';
              if (video && video.dataset.wasUserMuted !== 'true') {
                video.muted = false;
              }
            }
          }, 500);
        }
      })();
    `;

    pipWindow.webContents.executeJavaScript(pipInitScript).catch(() => {});
  }

  pipWindow.on('closed', () => {
    pipWindow = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.executeJavaScript(`
        const overlay = document.getElementById('yt-app-main-pip-overlay');
        if (overlay) overlay.style.display = 'none';
      `).catch(() => {});
    }
  });

  return { ok: true };
});

// --- SYSTEM TRAY ---
app.whenReady().then(() => {
  createWindow();
  initDiscordRPC();

  tray = new Tray(path.join(__dirname, 'icon.ico'));
  const contextMenu = Menu.buildFromTemplate([
    { label: 'Mở YouTube Desktop', click: () => { mainWindow.show(); mainWindow.focus(); } },
    { type: 'separator' },
    { label: 'Thoát (Quit)', click: () => { isQuitting = true; app.quit(); } }
  ]);
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(contextMenu);
  tray.on('click', () => {
    if (mainWindow.isVisible()) mainWindow.hide();
    else { mainWindow.show(); mainWindow.focus(); }
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  destroyDiscordRPC();
});