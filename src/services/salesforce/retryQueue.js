const logger = require('../../config/logger');
const queue = [];
const MAX_RETRIES = 1;

function addJob(event, payload, sendFn, attempt = 1) {
    // STOP retry for QR events
    const noRetryEvents = [
        'QR_GENERATED',
        'SESSION_INACTIVE'
    ];

    if(noRetryEvents.includes(event) && attempt > 1) {
        logger.warn(`Retry Skipped ${event}`);
        return;
    }

    queue.push({
        event,
        payload,
        sendFn,
        attempt
    });
}

async function processQueue(){
    if(!queue.length){
        return;
    }

    const job = queue.shift();
    try {
        await job.sendFn(
            job.event,
            job.payload
        );

        logger.info(`Retry Success: ${job.event}`);

    } catch(err) {
        // DO NOT retry QR / session inactive
        if(['QR_GENERATED','SESSION_INACTIVE'].includes(job.event)) {
            return;
        }
    }
}

setInterval(processQueue, 10000);

module.exports = { addJob };