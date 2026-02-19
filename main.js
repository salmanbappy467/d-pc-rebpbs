const { app, BrowserWindow, Tray, Menu, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const Store = require('electron-store');
const { v4: uuidv4 } = require('uuid');
const AdmZip = require('adm-zip');
const worker = require('./worker'); 

if (!app.requestSingleInstanceLock()) { app.quit(); }

const store = new Store();
let mainWindow, tray;
let isQuitting = false;

const USER_DATA_PATH = app.getPath('userData');
const SCRIPTS_DIR = path.join(USER_DATA_PATH, 'scripts');
const USER_NODE_MODULES = path.join(SCRIPTS_DIR, 'node_modules');

const ZIP_URL = 'https://github.com/salmanbappy467/d-script/raw/main/m/mds.zip';
const ZIP_PATH = path.join(SCRIPTS_DIR, 'modules.zip');

if (!fs.existsSync(SCRIPTS_DIR)) {
    fs.mkdirSync(SCRIPTS_DIR, { recursive: true });
}

function downloadFile(url, dest, cb) {
    const file = fs.createWriteStream(dest);
    https.get(url, function(response) {
        if (response.statusCode === 302 || response.statusCode === 301) {
            downloadFile(response.headers.location, dest, cb);
            return;
        }
        if (response.statusCode !== 200) {
            fs.unlink(dest);
            if (cb) cb(`Server returned status ${response.statusCode}`);
            return;
        }
        response.pipe(file);
        file.on('finish', function() {
            file.close(cb);
        });
    }).on('error', function(err) {
        fs.unlink(dest);
        if (cb) cb(err.message);
    });
}

function flattenScriptsFolder() {
    const nestedScripts = path.join(SCRIPTS_DIR, 'scripts');
    if (fs.existsSync(nestedScripts)) {
        console.log("📂 Moving files from subfolder...");
        try {
            const files = fs.readdirSync(nestedScripts);
            files.forEach(file => {
                const src = path.join(nestedScripts, file);
                const dest = path.join(SCRIPTS_DIR, file);
                fs.cpSync(src, dest, { recursive: true, force: true });
            });
            fs.rmSync(nestedScripts, { recursive: true, force: true });
        } catch (e) { console.error("Flatten Error:", e); }
    }
}

async function setupEnvironment(window) {
    if (!fs.existsSync(USER_NODE_MODULES)) {
        console.log("⬇️ Downloading core files from GitHub...");
        if(window) window.webContents.send('status-update', { msg: 'DOWNLOADING LIB...', type: 'sync' });

        downloadFile(ZIP_URL, ZIP_PATH, (err) => {
            if (err) {
                console.error("Download Error:", err);
                if(window) window.webContents.send('status-update', { msg: 'DOWNLOAD FAILED', type: 'error' });
                setTimeout(initWorker, 3000); 
                return;
            }
            console.log("📦 Extracting...");
            if(window) window.webContents.send('status-update', { msg: 'INSTALLING...', type: 'sync' });
            try {
                const zip = new AdmZip(ZIP_PATH);
                zip.extractAllTo(SCRIPTS_DIR, true); 
                flattenScriptsFolder();
                try { fs.unlinkSync(ZIP_PATH); } catch(e){}
                console.log("✅ Setup Complete.");
                initWorker();
            } catch (e) {
                console.error("Extraction Error:", e);
                if(window) window.webContents.send('status-update', { msg: 'INSTALL FAILED', type: 'error' });
            }
        });
    } else {
        initWorker();
    }
}

const CONSTANTS = {
    INTERNAL_KEY: 'pbsnet-testistest',
    DEFAULT_SERVER: 'https://mtroom-server.koyeb.app',
    ICON: path.join(__dirname, 'icon.ico')
};

function getStrictMachineId(currentServer, currentKey) {
    const savedData = store.get('machineData'); 
    if (savedData && savedData.server === currentServer && savedData.key === currentKey) return savedData.id;
    const newId = `Worker-${uuidv4().slice(0, 8).toUpperCase()}`;
    store.set('machineData', { id: newId, server: currentServer, key: currentKey });
    return newId;
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 320, height: 350,
        resizable: false,
        icon: CONSTANTS.ICON,
        backgroundColor: '#0f172a',
        frame: false,
        title: "mtRoom auto",
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        show: false, skipTaskbar: true 
    });

    mainWindow.loadFile('index.html');
    mainWindow.webContents.on('did-finish-load', () => setupEnvironment(mainWindow));
    
    tray = new Tray(CONSTANTS.ICON);
    tray.setToolTip(`mtRoom Auto`);
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: 'Open Dashboard', click: showWindow },
        { label: 'Restart Service', click: () => { 
            worker.stopWorker(); 
            setTimeout(() => setupEnvironment(mainWindow), 1000); 
        }},
        { type: 'separator' },
        { label: 'Exit', click: () => { isQuitting = true; app.quit(); } }
    ]));
    tray.on('click', showWindow);

    if (!process.argv.includes('--hidden')) mainWindow.once('ready-to-show', showWindow);
    
    mainWindow.on('close', (e) => {
        if (!isQuitting) { e.preventDefault(); mainWindow.hide(); mainWindow.setSkipTaskbar(true); }
    });
}

function showWindow() {
    if (mainWindow) { 
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.setSkipTaskbar(false); mainWindow.show(); mainWindow.focus(); 
    }
}

function initWorker() {
    const config = store.get('config') || {};
    const workerConfig = {
        serverUrl: config.serverUrl || CONSTANTS.DEFAULT_SERVER,
        apiKey: (config.apiKey || CONSTANTS.INTERNAL_KEY).trim(),
        machineId: getStrictMachineId(config.serverUrl || CONSTANTS.DEFAULT_SERVER, config.apiKey || CONSTANTS.INTERNAL_KEY),
        scriptsDir: SCRIPTS_DIR
    };
    const sendToUI = (status) => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('status-update', status);
    };
    worker.startWorker(workerConfig, sendToUI);
}

ipcMain.on('save-setting', (e, data) => {
    let current = store.get('config') || {};
    if (data.type === 'server') current.serverUrl = data.value;
    if (data.type === 'key') current.apiKey = data.value;
    store.set('config', current);
    setTimeout(() => setupEnvironment(mainWindow), 500);
});
ipcMain.on('minimize', () => { mainWindow.hide(); mainWindow.setSkipTaskbar(true); });
ipcMain.on('open-web', () => shell.openExternal('https://rebpbs-new.pages.dev'));
app.whenReady().then(createWindow);