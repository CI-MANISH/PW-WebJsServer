const logger = require('../../config/logger');
const retryMap = new Map();
const MAX_RETRY = 5;

async function reconnect(createSession, userId){
    const retries = retryMap.get(userId) || 0;
    if(retries >= MAX_RETRY) {
        logger.error(`Reconnect limit reached ${userId}`);
        return;
    }
    retryMap.set(userId, retries + 1);

    logger.info(`Reconnect attempt ${ retries + 1 } ${userId}`);

    setTimeout(
        async()=>{
            await createSession(userId);
        }, 5000
    );
}

function clearRetry(userId){
    retryMap.delete(userId);
}

module.exports = { reconnect, clearRetry };