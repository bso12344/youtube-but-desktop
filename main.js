const { app, BrowserWindow, shell, Menu, Tray, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

// --- BẬT FEATURE FLAG CHO NATIVE PIP & AUTOPLAY ( BẮT BUỘC ĐẶT Ở ĐẦU FILE ) ---
app.commandLine.appendSwitch('enable-features', 'PictureInPicture');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const DEBUG = false;
const APP_NAME = 'YouTube';

app.setName(APP_NAME);
if (process.platform === 'win32') {
  app.setAppUserModelId('com.bso.youtubedesktop');
}

let mainWindow;
let tray = null;
let isQuitting = false;
let injectInterval = null;

// --- BỘ TỪ ĐIỂN ĐA NGÔN NGỮ (I18N) ---
const I18N = {
  vi: {
    pipBtn: 'Chế độ PiP (Alt+P)',
    settingsTray: 'Thu xuống System Tray khi bấm nút X',
    settingsBoot: 'Khởi động cùng Windows',
    settingsNav: 'Tự động ẩn cụm nút điều hướng'
  },
  en: {
    pipBtn: 'Picture-in-Picture (Alt+P)',
    settingsTray: 'Minimize to System Tray on close',
    settingsBoot: 'Start on System Boot',
    settingsNav: 'Auto-hide navigation bar'
  },
  es: {
    pipBtn: 'Modo PiP (Alt+P)',
    settingsTray: 'Minimizar a la bandeja del sistema al cerrar',
    settingsBoot: 'Iniciar con Windows',
    settingsNav: 'Ocultar automáticamente la barra de navegación'
  },
  fr: {
    pipBtn: 'Mode PiP (Alt+P)',
    settingsTray: 'Réduire dans la barre des tâches à la fermeture',
    settingsBoot: 'Lancer au démarrage de Windows',
    settingsNav: 'Masquer automatiquement la barre de navigation'
  },
  de: {
    pipBtn: 'PiP-Modus (Alt+P)',
    settingsTray: 'Beim Schließen in den System Tray minimieren',
    settingsBoot: 'Mit Windows starten',
    settingsNav: 'Navigationsleiste automatisch ausblenden'
  },
  ja: {
    pipBtn: 'PiPモード (Alt+P)',
    settingsTray: '閉じる時にシステムトレイに最小化',
    settingsBoot: 'Windows起動時に実行',
    settingsNav: 'ナビゲーションバーを自動的に隠す'
  },
  ko: {
    pipBtn: 'PiP 모드 (Alt+P)',
    settingsTray: '닫을 때 시스템 트레이로 최소화',
    settingsBoot: 'Windows 시작 시 자동 실행',
    settingsNav: '탐색 모음 자동 숨기기'
  },
  zh: {
    pipBtn: '画中画模式 (Alt+P)',
    settingsTray: '关闭时最小化到系统托盘',
    settingsBoot: '开机自启动',
    settingsNav: '自动隐藏导航栏'
  }
};

// File lưu cấu hình người dùng
const settingsPath = path.join(app.getPath('userData'), 'user-settings.json');
let userSettings = {
  minimizeToTray: true,
  startOnBoot: false,
  autoHideNav: false,
  alwaysOnTop: false
};

// Đọc settings từ máy
try {
  if (fs.existsSync(settingsPath)) {
    userSettings = { ...userSettings, ...JSON.parse(fs.readFileSync(settingsPath, 'utf8')) };
  }
} catch (e) {
  console.error('Lỗi đọc settings:', e);
}

function saveUserSettings(newSettings) {
  userSettings = { ...userSettings, ...newSettings };
  try {
    fs.writeFileSync(settingsPath, JSON.stringify(userSettings, null, 2));
  } catch (e) {
    console.error('Lỗi ghi settings:', e);
  }
  
  if (mainWindow) {
    mainWindow.setAlwaysOnTop(!!userSettings.alwaysOnTop);
  }
  app.setLoginItemSettings({
    openAtLogin: !!userSettings.startOnBoot,
    path: app.getPath('exe')
  });
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

  // 1. Phím tắt Reload / DevTools
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

  // 2. Thu xuống System Tray khi bấm nút X
  mainWindow.on('close', (event) => {
    if (!isQuitting && userSettings.minimizeToTray) {
      event.preventDefault();
      mainWindow.hide();
      return false;
    }
  });

  // 3. Script Tiêm UI & Logic Native PiP
  const injectScript = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;

    const canGoBack = mainWindow.webContents.canGoBack();
    const canGoForward = mainWindow.webContents.canGoForward();

    const script = `
      (function() {
        const SVG_NS = 'http://www.w3.org/2000/svg';
        const I18N = ${JSON.stringify(I18N)};

        function getLangCode() {
          const langAttr = document.documentElement.lang || 'en';
          return langAttr.split('-')[0].toLowerCase();
        }

        function getDict() {
          return I18N[getLangCode()] || I18N.en;
        }

        // --- A. BẬT/TẮT NATIVE PIP ---
        async function toggleNativePiP() {
          const video = document.querySelector('video');
          if (!video) return;

          try {
            if (document.pictureInPictureElement) {
              await document.exitPictureInPicture();
            } else {
              video.removeAttribute('disablepictureinpicture');
              await video.requestPictureInPicture();
              video.play(); // Sửa lỗi tự pause của YouTube
            }
          } catch (err) {
            console.error('Lỗi khi kích hoạt Native PiP:', err);
          }
        }

        // Bắt phím tắt Alt + P để kích hoạt PiP nhanh
        if (!window.hasPipHotkey) {
          window.hasPipHotkey = true;
          window.addEventListener('keydown', (e) => {
            if (e.altKey && e.code === 'KeyP') {
              toggleNativePiP();
            }
          });
        }

        // --- B. TIÊU ĐỀ CỬA SỔ ---
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

        // --- C. TẠO CỤM NÚT ĐIỀU HƯỚNG ---
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

        // --- D. POP-UP MENU KHI CLICK NÚT "..." ---
        function toggleMoreMenu() {
          let menu = document.getElementById('yt-app-more-menu');
          if (menu) {
            menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
            return;
          }

          const dict = getDict();
          menu = document.createElement('div');
          menu.id = 'yt-app-more-menu';
          menu.style.cssText = 'position: fixed !important; bottom: 80px !important; right: 30px !important; width: 190px !important; background: rgba(24, 24, 24, 0.95) !important; backdrop-filter: blur(16px) !important; border: 1px solid rgba(255, 255, 255, 0.15) !important; border-radius: 12px !important; box-shadow: 0 10px 30px rgba(0,0,0,0.8) !important; z-index: 2147483647 !important; padding: 6px !important; display: block; color: #fff; font-family: sans-serif; font-size: 13px;';

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

          // Item 1: Native Picture-in-Picture
          menu.appendChild(makeMenuItem(dict.pipBtn, 'M19 11h-8v6h8v-6zm4 8V5c0-1.1-.9-2-2-2H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 0H3V5h18v14z', () => {
            toggleNativePiP();
          }));

          // Item 2: Ghim màn hình (Always on Top)
          menu.appendChild(makeMenuItem('Ghim màn hình', 'M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z', () => {
            if (window.electronAPI) window.electronAPI.toggleAlwaysOnTop();
          }));

          // Item 3: Bảng Cài đặt
          menu.appendChild(makeMenuItem('Cài đặt App', 'M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.39-.3-.61-.22l-2.49 1c-.52-.4-1.08-.73-1.69-.98l-.38-2.65C14.46 2.18 14.25 2 14 2h-4c-.25 0-.46.18-.49.42l-.38 2.65c-.61.25-1.17.59-1.69.98l-2.49-1c-.23-.09-.49 0-.61.22l-2 3.46c-.13.22-.07.49.12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65c-.19.15-.24.42-.12.64l2 3.46c.12.22.39.3.61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.03.24.24.42.49.42h4c.25 0 .46-.18.49-.42l.38-2.65c.61-.25 1.17-.59 1.69-.98l2.49 1c.23.09.49 0 .61-.22l2-3.46c.12-.22.07-.49-.12-.64l-2.11-1.65zM12 15.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5 3.5 1.57 3.5 3.5-1.57 3.5-3.5 3.5z', () => {
            openSettingsModal();
          }));

          (document.body || document.documentElement).appendChild(menu);
        }

        // --- E. BẢNG SETTINGS MODAL ---
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

              // Phần Thông tin App
              const aboutBox = document.createElement('div');
              aboutBox.style.cssText = 'margin-top: 15px; padding-top: 15px; border-top: 1px solid rgba(255,255,255,0.1); font-size: 12px; color: #aaa; display: flex; justify-content: space-between; align-items: center;';
              aboutBox.innerText = 'Phiên bản 1.0.0 (Native PiP)';

              const ghBtn = document.createElement('button');
              ghBtn.innerText = 'GitHub Repo';
              ghBtn.style.cssText = 'background: #333; color: #fff; border: 1px solid #555; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px;';
              ghBtn.onclick = () => window.electronAPI.openExternal('https://github.com');

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

        // --- F. MIỄN TRỪ TRÁCH NHIỆM ---
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

        function runAll() {
          try { updateTitle(); } catch(e){}
          try { createButtons(); } catch(e){}
          try { createDisclaimer(); } catch(e){}
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

// --- IPC HANDLERS ---
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

// --- SYSTEM TRAY ---
app.whenReady().then(() => {
  createWindow();

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