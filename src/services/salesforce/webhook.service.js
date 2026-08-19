const axios = require('axios');
const logger = require('../../config/logger');
const { addJob } = require('./retryQueue');

async function internalSend(event, payload, webhookUrl) {
    if(!webhookUrl) {
        throw new Error('webhookUrl required');
    }

    logger.error(`Webhook Auto create : ${event}`);

    await axios.post(webhookUrl, { event, ...payload },
        {
            timeout: 300000,
            headers: {
                'Content-Type': 'application/json'
            }
        }
    );
}

async function sendWebhook(event, payload={}, webhookUrl){
    try {
        await internalSend( event, payload, webhookUrl);
    } catch(err) {
        logger.error(`Webhook Failed1: ${event} : ${err.message}`);

        if (event === 'CONNECTED' || event === 'SESSION_DISCONNECTED') {
            logger.info(`Skipping webhook retry: ${event}`);
            return;
        }
        
        // addJob(event, payload, internalSend);;
    }
}

module.exports = { sendWebhook };