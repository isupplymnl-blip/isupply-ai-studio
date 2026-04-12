'use strict';

const { app, BrowserWindow, Menu, ipcMain, shell } = require('electron');
const path   = require('path');
const fs     = require('fs');
const http   = require('http');
const net    = require('net');
const { fork, spawn } = require('child_process');

// ─── Config ───────────────────────────────────────────────────────────────────
const CONFIG_PATH = path.join(app.getPath('userData'), 'studio-config.json');

function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch { return {}; }
}
function writeConfig(data) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf8');
}

// ─── Port discovery ───────────────────────────────────────────────────────────
let serverPort = 3000;

function findFreePort(from = 3000) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(findFreePort(from + 1)));
    srv.once('listening', () => { srv.close(); resolve(from); });
    srv.listen(from, '127.0.0.1');
  });
}

// ─── Next.js server ───────────────────────────────────────────────────────────
let serverProcess = null;

function getServerDir() {
  // Packaged: resources/server contains the standalone build
  // Dev: project root
  return app.isPackaged
    ? path.join(process.resourcesPath, 'server')
    : path.join(__dirname, '..');
}

function startServer(config) {
  const serverDir = getServerDir();

  const env = {
    ...process.env,
    GEMINI_API_KEY:               config.geminiApiKey ?? '',
    ECCO_API_KEY:                 config.eccoApiKey   ?? '',
    AI_PROVIDER:                  config.provider     ?? 'gemini',
    PORT:                         String(serverPort),
    HOSTNAME:                     '127.0.0.1',
    NODE_ENV:                     'production',
    // Writable directory for uploads, generated images, and assets.json.
    // Must be outside Program Files to avoid EPERM on write.
    USER_DATA_DIR:                app.getPath('userData'),
    // Supabase client is unused at runtime but the module import
    // needs non-empty strings to avoid a createClient() crash.
    NEXT_PUBLIC_SUPABASE_URL:     process.env.NEXT_PUBLIC_SUPABASE_URL     || 'http://localhost',
    NEXT_PUBLIC_SUPABASE_ANON_KEY:process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY|| 'unused',
  };

  if (app.isPackaged) {
    // Standalone server bundled at resources/server/server.js
    serverProcess = fork(
      path.join(serverDir, 'server.js'),
      [],
      { cwd: serverDir, env, silent: true }
    );
  } else {
    // Development — `next start` via the local node_modules binary
    const nextBin = process.platform === 'win32'
      ? path.join(serverDir, 'node_modules', '.bin', 'next.cmd')
      : path.join(serverDir, 'node_modules', '.bin', 'next');
    serverProcess = spawn(nextBin, ['start', '-p', String(serverPort)], {
      cwd: serverDir, env, stdio: 'pipe', shell: false,
    });
  }

  serverProcess.stdout?.on('data', d => process.stdout.write('[next] ' + d));
  serverProcess.stderr?.on('data', d => process.stderr.write('[next] ' + d));
  serverProcess.on('exit', (code) => console.log('[next] exited with code', code));
}

// Poll until the Next.js server responds
function waitForServer(timeoutMs = 90_000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const attempt = () => {
      const req = http.get(`http://127.0.0.1:${serverPort}/`, (res) => {
        res.resume();
        if (res.statusCode < 500) return resolve();
        setTimeout(attempt, 700);
      });
      req.setTimeout(1200, () => { req.destroy(); });
      req.on('error', () => {
        if (Date.now() > deadline) return reject(new Error('Server did not start within 90 s.'));
        setTimeout(attempt, 700);
      });
    };
    attempt();
  });
}

// ─── Windows ──────────────────────────────────────────────────────────────────
let mainWindow  = null;
let setupWindow = null;

function buildAppMenu() {
  const config = readConfig();
  const template = [
    {
      label: 'iSupply AI Studio',
      submenu: [
        {
          label: 'Settings — Change API Key / Provider',
          click: () => openSetupWindow(),
        },
        { type: 'separator' },
        {
          label: 'Open in System Browser',
          click: () => shell.openExternal(`http://127.0.0.1:${serverPort}`),
        },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'forceReload' },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function openSetupWindow() {
  if (setupWindow) { setupWindow.focus(); return; }

  setupWindow = new BrowserWindow({
    width: 520, height: 560,
    resizable: false,
    title: 'iSupply AI Studio — Setup',
    backgroundColor: '#0A0A0B',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  setupWindow.setMenuBarVisibility(false);
  setupWindow.loadFile(path.join(__dirname, 'setup.html'));

  setupWindow.webContents.on('did-finish-load', () => {
    const cfg = readConfig();
    setupWindow?.webContents.send('prefill-config', {
      provider:     cfg.provider     ?? 'gemini',
      geminiApiKey: cfg.geminiApiKey ?? '',
      eccoApiKey:   cfg.eccoApiKey   ?? '',
    });
  });

  setupWindow.on('closed', () => { setupWindow = null; });
}

async function openMainWindow() {
  if (mainWindow) { mainWindow.focus(); return; }

  mainWindow = new BrowserWindow({
    width: 1440, height: 900,
    minWidth: 1024, minHeight: 680,
    title: 'iSupply AI Studio',
    backgroundColor: '#0A0A0B',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  buildAppMenu();

  // Show a branded splash while the server boots
  const splash = `data:text/html,<html style="background:%230A0A0B;margin:0;display:flex;` +
    `align-items:center;justify-content:center;height:100vh">` +
    `<div style="text-align:center;font-family:system-ui;color:%237C3AED">` +
    `<div style="font-size:52px;font-weight:900;letter-spacing:-2px;margin-bottom:14px">iS</div>` +
    `<p style="color:%2355556A;font-size:13px;margin:0">Starting server&#8230;</p></div></html>`;

  await mainWindow.loadURL(splash);
  mainWindow.show();

  try {
    await waitForServer();
  } catch (err) {
    await mainWindow.loadURL(
      `data:text/html,<html style="background:%230A0A0B;margin:0;display:flex;align-items:center;` +
      `justify-content:center;height:100vh"><div style="font-family:system-ui;color:%23F43F5E;` +
      `text-align:center;padding:40px"><h2>Server failed to start</h2>` +
      `<p style="color:%2355556A">${err.message}</p>` +
      `<p style="color:%2355556A;font-size:12px">Check that port ${serverPort} is not in use, ` +
      `then restart the app.</p></div></html>`
    );
    return;
  }

  await mainWindow.loadURL(`http://127.0.0.1:${serverPort}`);
  mainWindow.on('closed', () => { mainWindow = null; });

  // Redirect new-window links to system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) shell.openExternal(url);
    return { action: 'deny' };
  });
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────
ipcMain.handle('get-config', () => readConfig());

ipcMain.handle('save-config', async (_e, { provider, apiKey }) => {
  if (!apiKey?.trim()) return { error: 'API key cannot be empty.' };

  const config     = readConfig();
  const isFirstRun = !config.geminiApiKey && !config.eccoApiKey;
  const keyField   = provider === 'ecco' ? 'eccoApiKey' : 'geminiApiKey';
  const newConfig  = { ...config, provider, [keyField]: apiKey.trim() };
  writeConfig(newConfig);

  if (isFirstRun) {
    startServer(newConfig);
    setupWindow?.close();
    await openMainWindow();
  } else {
    serverProcess?.kill();
    await new Promise(r => setTimeout(r, 1200));
    startServer(newConfig);
    setupWindow?.close();
    mainWindow?.webContents.reload();
  }
  return { ok: true };
});

// ─── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  serverPort = await findFreePort(3000);

  const config  = readConfig();
  const hasKey  = config.provider === 'ecco' ? !!config.eccoApiKey : !!config.geminiApiKey;
  if (hasKey) {
    startServer(config);
    await openMainWindow();
  } else {
    openSetupWindow();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    serverProcess?.kill();
    app.quit();
  }
});

app.on('activate', async () => {
  if (!mainWindow && !setupWindow) {
    const config = readConfig();
    const hasKey = config.provider === 'ecco' ? !!config.eccoApiKey : !!config.geminiApiKey;
    if (hasKey) {
      await openMainWindow();
    } else {
      openSetupWindow();
    }
  }
});

app.on('before-quit', () => {
  serverProcess?.kill();
});
