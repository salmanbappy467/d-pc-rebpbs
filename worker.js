// worker.js - Final Fix for "Unknown Action"
const io = require('socket.io-client');
const rebpbs = require('./rebpbs'); 

let socket = null;
let pingInterval = null;

function startWorker(config, sendToUI) {
    const { serverUrl, apiKey, machineId } = config;

    // ক্লিনআপ
    if (socket) {
        if (pingInterval) clearInterval(pingInterval);
        socket.disconnect();
        socket.removeAllListeners();
        socket = null;
    }

    console.log(`🔌 Server: ${serverUrl}`);
    console.log(`🆔 ID: ${machineId}`);

    // কানেকশন অপশন
    socket = io(serverUrl, {
        query: { type: 'worker' },
        auth: { machineId, apiKey },
        reconnection: true,             
        reconnectionAttempts: Infinity, 
        reconnectionDelay: 2000,        
        timeout: 20000,                 
        transports: ['websocket', 'polling'],
        forceNew: true
    });

    socket.on('connect', () => {
        console.log('✅ Connected');
        sendToUI({ msg: 'ONLINE', type: 'success' });
        
        // Keep-Alive Heartbeat
        if (pingInterval) clearInterval(pingInterval);
        pingInterval = setInterval(() => {
            if (socket.connected) {
                socket.emit('worker_ping', { uptime: process.uptime() });
            }
        }, 25000); 
    });

    socket.on('disconnect', (reason) => {
        console.log(`⚠️ Disconnected: ${reason}`);
        sendToUI({ msg: 'OFFLINE', type: 'error' });
    });

    socket.on('connect_error', (err) => {
        if (err.message.includes("auth")) {
            sendToUI({ msg: 'AUTH FAILED', type: 'error' });
        } else {
            sendToUI({ msg: 'RETRYING...', type: 'sync' });
        }
    });

    socket.on('execute_task', async (job) => {
        console.log(`⚡ Raw Task: ${job.taskType}`);
        sendToUI({ msg: 'WORKING...', type: 'work' });

        try {
            // 🔥 ফিক্স: অ্যাকশন নাম ঠিক করা
            let actionName = job.taskType;
            
            // ১. যদি টাস্কের নাম ফাইলের নাম হয় (যেমন: rebpbs.js), তবে এটি আসল অ্যাকশন নয়
            if (actionName.toLowerCase().endsWith('.js')) {
                // পে-লোড এর ভেতর আসল অ্যাকশন খুঁজব, না পেলে 'CHECK'
                actionName = job.payload.action || 'CHECK';
            }

            console.log(`▶ Process Action: ${actionName}`);

            const result = await rebpbs.run({
                ...job.payload,
                action: actionName // ঠিক করা অ্যাকশন পাঠানো হলো
            });

            sendResult(job.requestId, result);
            sendToUI({ msg: 'DONE', type: 'success' });
            setTimeout(() => sendToUI({ msg: 'ONLINE', type: 'active' }), 2000);

        } catch (error) {
            console.error(`❌ Error: ${error.message}`);
            sendResult(job.requestId, { error: error.message });
            sendToUI({ msg: 'FAILED', type: 'error' });
        }
    });

    function sendResult(id, res) {
        socket.emit('task_completed', { requestId: id, result: res });
    }
}

module.exports = { startWorker };