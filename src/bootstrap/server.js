const fs = require('fs');
const path = require('path');

const { createSession, getSessionsPath } = require('../services/whatsapp/clientFactory');
const { startMonitor } = require('../services/whatsapp/sessionMonitor');

async function restoreSessions() {
    const dir = getSessionsPath();

    if (!fs.existsSync(dir)) {
        return;
    }

    const folders = fs.readdirSync(dir);

    for (const folder of folders) {
        if (!folder.startsWith('session-')) {
            continue;
        }

        const userId = folder.replace('session-', '');

        createSession(userId)
            .catch(err=>{
                console.error('Restore failed', err.message);
            });
    }
}

async function bootstrap() {
    // await restoreSessions();
    startMonitor();
}

module.exports = { bootstrap, restoreSessions};
