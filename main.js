// main.js - Settings Save Fix
const { app, BrowserWindow, Tray, Menu, ipcMain, shell } = require('electron');
const path = require('path');
const Store = require('electron-store');
const AutoLaunch = require('auto-launch');
const { v4: uuidv4 } = require('uuid');
const worker = require('./worker'); 

// সিঙ্গেল ইন্সট্যান্স লক
if (!app.requestSingleInstanceLock()) { app.quit(); }

const store = new Store();
let mainWindow, tray;
let isQuitting = false;

const CONSTANTS = {
    INTERNAL_KEY: 'pbsnet-wqxfhb1wsvq',
    DEFAULT_SERVER: 'https://mtroom-server.koyeb.app',
    ICON: path.join(__dirname, 'icon.ico')
};

// 🔥 SMART MACHINE ID LOGIC
function getStrictMachineId(currentServer, currentKey) {
    const savedData = store.get('machineData'); 

    if (savedData && savedData.server === currentServer && savedData.key === currentKey) {
        return savedData.id;
    }

    const newId = `Worker-${uuidv4().slice(0, 8).toUpperCase()}`;
    console.log(`🆕 Configuration Changed! New ID: ${newId}`);
    
    store.set('machineData', {
        id: newId,
        server: currentServer,
        key: currentKey
    });

    return newId;
}

const autoLauncher = new AutoLaunch({ name: 'mtRoom auto', isHidden: true });
autoLauncher.isEnabled().then(enabled => { if (!enabled) autoLauncher.enable(); });

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 320, height: 350,
        resizable: false,
        icon: CONSTANTS.ICON,
        backgroundColor: '#0f172a',
        frame: false,
        title: "mtRoom auto",
        webPreferences: { nodeIntegration: true, contextIsolation: false },
        show: false, skipTaskbar: true 
    });

    mainWindow.loadFile('index.html');
    mainWindow.webContents.on('did-finish-load', () => initWorker());
    mainWindow.on('closed', () => { mainWindow = null; });

    tray = new Tray(CONSTANTS.ICON);
    tray.setToolTip(`mtRoom Auto`);
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: 'Open Dashboard', click: showWindow },
        { label: 'Reconnect', click: initWorker },
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

// 🔥 WORKER INITIALIZATION (FIXED)
function initWorker() {
    // স্টোর থেকে ফ্রেশ কনফিগ লোড
    const config = store.get('config') || {};
    
    console.log("📂 Loaded Config:", config); // ডিবাগ লগ

    const serverUrl = config.serverUrl || CONSTANTS.DEFAULT_SERVER;
    
    // API Key লজিক: যদি স্টোরে থাকে তবে সেটি, না হলে ডিফল্ট
    let apiKey = CONSTANTS.INTERNAL_KEY; // ডিফল্ট

    if (config.apiKey && config.apiKey.trim().length > 0) {
        apiKey = config.apiKey.trim();
        console.log("🔑 Using Custom API Key");
    } else {
        console.log("🔑 Using Default Internal Key");
    }

    // মেশিন আইডি জেনারেট
    const machineId = getStrictMachineId(serverUrl, apiKey);
    
    if(tray) tray.setToolTip(`ID: ${machineId}`);

    const workerConfig = {
        serverUrl: serverUrl,
        apiKey: apiKey,
        machineId: machineId,
        userDataPath: app.getPath('userData')
    };

    const sendToUI = (status) => {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('status-update', status);
    };

    try {
        worker.startWorker(workerConfig, sendToUI);
        sendToUI({ msg: 'STARTING...', type: 'sync' });
    } catch (e) {
        console.error("Init Error:", e);
    }
}

// 🔥 SETTINGS SAVE HANDLER (FIXED)
ipcMain.on('save-setting', (e, data) => {
    console.log(`💾 Saving Setting: ${data.type} = ${data.value}`);
    
    let current = store.get('config') || {};
    
    if (data.type === 'server') {
        current.serverUrl = data.value;
    }
    
    if (data.type === 'key') {
        // ফাঁকা স্ট্রিং আসলেও সেভ করব, যাতে ইউজার চাইলে ডিফল্টে ফিরে যেতে পারে
        current.apiKey = data.value; 
    }
    
    store.set('config', current);
    
    console.log("✅ Config Saved to Disk");

    // সেভ হওয়ার একটু পর রিস্টার্ট (যাতে রাইট অপারেশন শেষ হয়)
    setTimeout(() => {
        console.log("♻️ Restarting Worker with New Config...");
        initWorker();
    }, 500);
});

ipcMain.on('minimize', () => { mainWindow.hide(); mainWindow.setSkipTaskbar(true); });
ipcMain.on('open-web', () => shell.openExternal('https://pbsnet.pages.dev'));

app.whenReady().then(createWindow);