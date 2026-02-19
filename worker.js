const io = require('socket.io-client');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let socket = null;
let pingInterval = null;
let updateInterval = null;
let SCRIPTS_PATH = '';

function getFileHash(filePath) {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath);
    return crypto.createHash('md5').update(content).digest('hex');
}

function startWorker(config, sendToUI) {
    const { serverUrl, apiKey, machineId, scriptsDir } = config;
    SCRIPTS_PATH = scriptsDir;

    if (socket) stopWorker();

    console.log(`🔌 Connecting to: ${serverUrl}`);

    socket = io(serverUrl, {
        query: { type: 'worker' },
        auth: { machineId, apiKey },
        reconnection: true,
        forceNew: true
    });

    socket.on('connect', () => {
        sendToUI({ msg: 'ONLINE', type: 'active' });
        
        // কানেক্ট হওয়ার সাথে সাথে স্ক্রিপ্ট চেক
        console.log("📥 Checking for script updates...");
        socket.emit('get_scripts_manifest');

        pingInterval = setInterval(() => {
            if (socket.connected) socket.emit('worker_ping', { uptime: process.uptime() });
        }, 20000);

        // প্রতি মিনিটে অটো আপডেট চেক
        updateInterval = setInterval(() => {
            if (socket.connected) socket.emit('get_scripts_manifest');
        }, 60000);
    });

    // সার্ভার থেকে স্ক্রিপ্ট লিস্ট রিসিভ
    socket.on('scripts_manifest', (manifest) => {
        let updatesNeeded = 0;
        if (!Array.isArray(manifest)) return;

        manifest.forEach(remoteFile => {
            const localPath = path.join(SCRIPTS_PATH, remoteFile.name);
            
            // ফাইল না থাকলে বা হ্যাশ না মিললে ডাউনলোড রিকোয়েস্ট (সার্ভার থেকে)
            if (getFileHash(localPath) !== remoteFile.hash) {
                console.log(`⬇️ Syncing Script: ${remoteFile.name}`);
                socket.emit('request_file', remoteFile.name);
                updatesNeeded++;
            }
        });

        if (updatesNeeded > 0) {
            sendToUI({ msg: 'UPDATING...', type: 'sync' });
        }
    });

    // স্ক্রিপ্ট রিসিভ এবং সেভ
    socket.on('receive_file', (file) => {
        try {
            const filePath = path.join(SCRIPTS_PATH, file.name);
            fs.writeFileSync(filePath, file.content);
            
            // মেমোরি থেকে পুরোনো ভার্সন ডিলিট (Hot Reload)
            try { delete require.cache[require.resolve(filePath)]; } catch(e){}
            
            console.log(`✅ Updated: ${file.name}`);
            sendToUI({ msg: 'UPDATED', type: 'success' });
            setTimeout(() => sendToUI({ msg: 'ONLINE', type: 'active' }), 1500);
        } catch (e) { 
            console.error("Write Error:", e);
        }
    });

    // টাস্ক এক্সিকিউশন
    socket.on('execute_task', async (job) => {
        sendToUI({ msg: 'WORKING...', type: 'work' });
        try {
            let scriptName = job.taskType.endsWith('.js') ? job.taskType : `${job.taskType}.js`;
            const scriptPath = path.join(SCRIPTS_PATH, scriptName);

            // ফাইল না থাকলে ডাউনলোড চেয়ে অপেক্ষা করা
            if (!fs.existsSync(scriptPath)) {
                socket.emit('request_file', scriptName);
                throw new Error(`Script '${scriptName}' missing. Downloading... please retry.`);
            }

            // ডাইনামিক লোড
            delete require.cache[require.resolve(scriptPath)];
            const scriptModule = require(scriptPath); // Fixed Variable Name

            if (!scriptModule.run) throw new Error("Invalid Script: No 'run' function found.");

            console.log(`▶ Running ${scriptName}`);
            const result = await scriptModule.run({
                ...job.payload,
                action: job.payload.action || 'CHECK'
            });

            socket.emit('task_completed', { requestId: job.requestId, result });
            sendToUI({ msg: 'DONE', type: 'success' });
            setTimeout(() => sendToUI({ msg: 'ONLINE', type: 'active' }), 2000);

        } catch (error) {
            console.error(`❌ Task Error: ${error.message}`);
            socket.emit('task_completed', { requestId: job.requestId, result: { error: error.message } });
            sendToUI({ msg: 'FAILED', type: 'error' });
            setTimeout(() => sendToUI({ msg: 'ONLINE', type: 'active' }), 3000);
        }
    });
}

function stopWorker() {
    if (socket) { socket.disconnect(); socket = null; }
    if (pingInterval) clearInterval(pingInterval);
    if (updateInterval) clearInterval(updateInterval);
}

module.exports = { startWorker, stopWorker };