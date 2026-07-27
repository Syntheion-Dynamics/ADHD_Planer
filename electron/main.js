const { app, BrowserWindow } = require('electron');
const path = require('path');
const net = require('net');
const fs = require('fs');
const { spawn } = require('child_process');
const http = require('http');

let mainWindow = null;
let sidecar = null;
let chosenPort = null;
let quitting = false;

function isPackaged() {
  return app.isPackaged;
}

/** Kořen se server.py + index.html (dev = repo, prod = resources/app-static) */
function getStaticRoot() {
  if (isPackaged()) {
    return path.join(process.resourcesPath, 'app-static');
  }
  return path.join(__dirname, '..');
}

function getPythonCommand(staticRoot) {
  if (isPackaged()) {
    const embed = path.join(process.resourcesPath, 'python', 'python.exe');
    if (fs.existsSync(embed)) return { cmd: embed, args: [] };
  }
  // Dev / fallback: systémový Python
  return { cmd: process.platform === 'win32' ? 'python' : 'python3', args: [] };
}

function findFreePort(start = 18080, maxTries = 40) {
  return new Promise((resolve, reject) => {
    let port = start;
    const tryListen = () => {
      if (port > start + maxTries) {
        reject(new Error('No free port found'));
        return;
      }
      const server = net.createServer();
      server.unref();
      server.on('error', () => {
        port += 1;
        tryListen();
      });
      server.listen(port, '127.0.0.1', () => {
        server.close(() => resolve(port));
      });
    };
    tryListen();
  });
}

function waitForPing(port, timeoutMs = 8000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(
        { hostname: '127.0.0.1', port, path: '/api/ping', timeout: 800 },
        (res) => {
          res.resume();
          if (res.statusCode === 200) resolve();
          else if (Date.now() - started > timeoutMs) reject(new Error('ping timeout'));
          else setTimeout(attempt, 200);
        }
      );
      req.on('error', () => {
        if (Date.now() - started > timeoutMs) reject(new Error('ping timeout'));
        else setTimeout(attempt, 200);
      });
      req.on('timeout', () => {
        req.destroy();
      });
    };
    attempt();
  });
}

function startSidecar(port) {
  const staticRoot = getStaticRoot();
  const dataDir = app.getPath('userData');
  const serverPy = path.join(staticRoot, 'server.py');
  const py = getPythonCommand(staticRoot);

  if (!fs.existsSync(serverPy)) {
    throw new Error(`server.py not found at ${serverPy}`);
  }

  const env = {
    ...process.env,
    PORT: String(port),
    PLANER_STATIC_DIR: staticRoot,
    PLANER_DATA_DIR: dataDir,
    PYTHONUTF8: '1',
  };

  const args = [...py.args, serverPy];
  sidecar = spawn(py.cmd, args, {
    cwd: staticRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });

  sidecar.stdout.on('data', (buf) => console.log(`[sidecar] ${buf}`));
  sidecar.stderr.on('data', (buf) => console.error(`[sidecar] ${buf}`));
  sidecar.on('exit', (code, signal) => {
    console.log(`[sidecar] exited code=${code} signal=${signal}`);
    sidecar = null;
    if (!quitting && mainWindow && !mainWindow.isDestroyed()) {
      // Sidecar spadl za běhu — zavřít okno ať uživatel ví
      mainWindow.close();
    }
  });

  return waitForPing(port);
}

function stopSidecar() {
  if (!sidecar) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(sidecar.pid), '/f', '/t'], { windowsHide: true });
    } else {
      sidecar.kill('SIGTERM');
    }
  } catch (e) {
    console.error('stopSidecar', e);
  }
  sidecar = null;
}

async function createWindow() {
  chosenPort = await findFreePort(18080);
  await startSidecar(chosenPort);

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: 'ADHD Planer',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  await mainWindow.loadURL(`http://127.0.0.1:${chosenPort}/`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  try {
    await createWindow();
  } catch (err) {
    console.error(err);
    stopSidecar();
    app.quit();
  }
});

app.on('before-quit', () => {
  quitting = true;
  stopSidecar();
});

app.on('window-all-closed', () => {
  quitting = true;
  stopSidecar();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow().catch((err) => {
      console.error(err);
      app.quit();
    });
  }
});
