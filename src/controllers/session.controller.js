const fs = require('fs');
const path = require('path');

const registry = require('../services/whatsapp/sessionRegistry');
const { createSession } = require('../services/whatsapp/clientFactory');
const { success, error } = require('../utils/response');
const { sendWebhook } = require('../services/salesforce/webhook.service');

/**
 * Get sessions storage path
 * @returns {string}
 */
function getSessionsPath() {
    const basePath = process.env.SESSION_STORAGE_PATH || path.join(process.cwd(), 'sessions');

    if (!fs.existsSync(basePath)) {
        fs.mkdirSync(basePath, {
            recursive: true
        });
    }

    return basePath;
}

/**
 * Delay helper
 * @param {number} ms
 * @returns {Promise}
 */
function delay(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

/**
 * Remove session directory
 * @param {string} userId
 */
async function removeSessionDirectory(userId) {
    try {
        const sessionsPath = getSessionsPath();
        const sessionDir = path.join(
            sessionsPath,
            `session-${userId}`
        );

        if (fs.existsSync(sessionDir)) {
            fs.rmSync(sessionDir, {
                recursive: true,
                force: true
            });
        }
    } catch (cleanupError) {
        console.log('[SESSION][CLEANUP]', cleanupError.message);
    }
}

/*
|--------------------------------------------------------------------------
| INIT SESSION
|--------------------------------------------------------------------------
*/
exports.init = async (req, res) => {
    try {
        const {userId, syncDays = 0, webhookUrl } = req.body;

        if (!webhookUrl) {
            return error(
                res,
                'webhookUrl required',
                400
            );
        }

        if (!userId) {
            return error(res, 'userId required', 400);
        }

        let session = registry.get(userId);

        /*
        |--------------------------------------------------------------------------
        | ALREADY CONNECTED - SAME ACTIVE CHANNEL TRACE
        |--------------------------------------------------------------------------
        */
        if (session?.connected) {
            return success(
                res,
                {
                    connected: true,
                    qrRequired: false,
                    phoneNumber: session.phoneNumber,
                    qrCode: null
                },
                'Already connected'
            );
        }

        if (session) {
            try {
                if (session.qrTimer) {
                    clearTimeout(session.qrTimer);
                }
                
                if (session.client) {
                    await session.client.destroy();
                }
            } catch (destroyError) {
                console.log('[SESSION][DESTROY]', destroyError.message);
            }

            registry.remove(userId);
            await delay(2000);
        }

        /*
        |--------------------------------------------------------------------------
        | CLEANUP STALE SESSION LOCAL DIRECTORIES
        |--------------------------------------------------------------------------
        */
        await removeSessionDirectory(userId);
        await delay(3000);
        
        /*
        |--------------------------------------------------------------------------
        | INITIALIZE BRAND NEW CLEAN WHATSAPP WORKER
        |--------------------------------------------------------------------------
        */
        await createSession(userId, Number(syncDays), webhookUrl);

        await delay(3500);

        session = registry.get(userId);

        return success(
            res,
            {
                connected: session?.connected || false,
                qrRequired: !session?.connected,
                phoneNumber: session?.phoneNumber || null,
                qrCode: session?.qrCode || null
            },
            session?.qrCode ? 'QR code generated successfully' : 'Session initialization started'
        );
    } catch (err) {
        return error(res, err.message);
    }
};

/*
|--------------------------------------------------------------------------
| SESSION STATUS
|--------------------------------------------------------------------------
*/
exports.status = async (req, res) => {
    try {
        const { userId } = req.params;

        const session = registry.get(userId);

        if (!session) {
            return success(
                res,
                {
                    exists: false,
                    connected: false,
                    qrAvailable: false,
                    qrCode: null
                }
            );
        }

        return success(
            res,
            {
                exists: true,
                connected: session.connected,
                phoneNumber: session.phoneNumber,
                qrAvailable: !!session.qrCode,
                qrCode: session.qrCode || null,
                lastActive: session.lastActive
            }
        );
    } catch (err) {
        return error(
            res,
            err.message
        );
    }
};

/*
|--------------------------------------------------------------------------
| GET QR CODE
|--------------------------------------------------------------------------
*/
exports.getQR = async (req, res) => {
    try {
        const { userId } = req.params;
        const session = registry.get(userId);

        if (!session) {
            return error(res, 'Session not found', 404);
        }

        return success(
            res,
            {
                connected: session.connected,
                qrCode: session.qrCode || null
            }, 'QR code retrieved'
        );
    } catch (err) {
        return error(res, err.message);
    }
};

/*
|--------------------------------------------------------------------------
| LOGOUT SESSION
|--------------------------------------------------------------------------
*/
exports.logout = async (req, res) => {
    try {
        const { userId } = req.body;

        if (!userId) {
            return error(res,'userId required',400);
        }

        const session = registry.get(userId);
        const webhookUrl = session?.webhookUrl;

        if (!session) {
            return error(res,'Session not found',404);
        }

        session.isLoggingOut = true;

        /*
        |--------------------------------------------------------------------------
        | LOGOUT
        |--------------------------------------------------------------------------
        */
        try {
            await sendWebhook('LOGOUT', { userId, status: 'LOGGED_OUT', timestamp: new Date().toISOString()}, webhookUrl);
            await session.client.logout();
        } catch(e) {
            console.log('[LOGOUT]', e.message);
        }

        /*
        |--------------------------------------------------------------------------
        | DESTROY CLIENT
        |--------------------------------------------------------------------------
        */
        try {
            await session.client.destroy();
        } catch(e) {
            console.log('[DESTROY]', e.message);
        }

        /*
        |--------------------------------------------------------------------------
        | FORCE CLOSE BROWSER PROCESS
        |--------------------------------------------------------------------------
        */
        try {
            const browser = session.client?.pupBrowser;

            if(browser) {
                const proc = browser.process();

                if(proc) {
                    proc.kill('SIGKILL');
                }

                await browser.close().catch(()=>{});
            }
        } catch(e) {
            console.log('[BROWSER CLOSE]', e.message);
        }

        /*
        |--------------------------------------------------------------------------
        | REMOVE REGISTRY
        |--------------------------------------------------------------------------
        */
        registry.remove(userId);

        /*
        |--------------------------------------------------------------------------
        | REMOVE SESSION FOLDER
        |--------------------------------------------------------------------------
        */

        const sessionsPath = getSessionsPath();
        const sessionDir = path.join(sessionsPath, `session-${userId}`);

        try {
            if(fs.existsSync(sessionDir)) {
                fs.rmSync(
                    sessionDir,
                    {
                        recursive:true,
                        force:true,
                        maxRetries:10,
                        retryDelay:500
                    }
                );
            }
        } catch(e) {
            console.log('[FOLDER REMOVE]', e.message);
        }

        /*
        |--------------------------------------------------------------------------
        | SHORT WAIT ONLY
        |--------------------------------------------------------------------------
        */
        await delay(2000);

        return success(res, {}, 'Logged out');
    } catch(err) {
        return error(res, err.message);
    }
};