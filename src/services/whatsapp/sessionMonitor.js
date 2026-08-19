const { SESSION_TIMEOUT_MS } = require('../../config/env');
const logger = require('../../config/logger');
const registry = require('./sessionRegistry');
const { sendWebhook } = require('../salesforce/webhook.service');

function startMonitor() {
    setInterval(async () => {
        const sessions = registry.all();

        for (const [userId, session] of sessions) {
            try {
                if (!session || !session.connected) {
                    continue;
                }

                /*
                 * Session expiry check
                 * Current value = 1 year
                 */
                const inactive = Date.now() - (session.lastActive || Date.now());

                if (inactive > SESSION_TIMEOUT_MS) {
                    logger.warn(`Session expired: ${userId}`);

                    await sendWebhook(
                        'SESSION_EXPIRED',
                        {
                            userId,
                            reason: 'INACTIVITY_TIMEOUT',
                            inactiveMs: inactive,
                            actionRequired: true,
                            timestamp: new Date().toISOString()
                        },
                        session.webhookUrl
                    );

                    try {
                        await session.client.logout();
                        await session.client.destroy();
                    } catch (e) {
                        logger.error(
                            `[SESSION CLEANUP] ${e.message}`
                        );
                    }

                    registry.remove(userId);
                    continue;
                }

                /*
                 * State check
                 */
                const state = await session.client.getState();

                if (state && state !== 'CONNECTED') {
                    await sendWebhook('SESSION_INACTIVE',
                        {
                            userId,
                            state
                        },
                        session.webhookUrl
                    );
                }

            } catch (err) {
                logger.error(`[SESSION MONITOR] ${userId} ${err.message}`);
            }
        }
    }, 1800000); // 5 minutes
}

module.exports = { startMonitor };