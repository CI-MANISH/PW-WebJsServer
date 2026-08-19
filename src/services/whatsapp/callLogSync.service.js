const logger = require('../../config/logger');
const { sendWebhook } = require('../salesforce/webhook.service');

const MAX_PAYLOAD_SIZE = 3.5 * 1024 * 1024;

function extractNumber(id = ''){
    return id.split('@')[0].split(':')[0];
}

async function safeWebhook(event, payload, url) {
    try {
        await sendWebhook(event,payload,url);
    } catch(err) {
        logger.error(err.message);
    }
}

exports.syncCallLogs = async (client, myNumber, webhookUrl, userId, syncDays) => {
    const chats = await client.getChats();
    const syncFromTime = Math.floor(Date.now()/1000) - (syncDays*24*60*60);

    let currentChunk = [];
    let currentSize = 0;
    let chunkNumber = 1;

    for(const chat of chats) {
        try {
            const msgs = await chat.fetchMessages({ limit:100 });

            for(const msg of msgs) {
                if(msg.timestamp<syncFromTime)
                    continue;

                const isCallNotification =
                    msg.type==="call_log" ||
                    msg._data?.type==="call_log" ||
                    (msg.type==="gp2" && msg._data?.subtype?.includes("call")) ||
                    (msg.type==="notification" && msg.body?.toLowerCase().includes("call"));

                if(!isCallNotification)
                    continue;

                let contact = await chat.getContact();
                let customerNumber = contact?.id?.user || contact?.number || extractNumber(chat.id._serialized);

                const payload = {
                    userId,
                    message_id: msg.id?._serialized || msg.id?.id,
                    timestamp: String(msg.timestamp),
                    direction: msg.fromMe ? 'Outbound' : 'Inbound',
                    sender_number: msg.fromMe ? myNumber : customerNumber,
                    recipient_number: msg.fromMe ? customerNumber : myNumber,
                    customer_number: customerNumber,
                    customer_name: contact?.pushname || contact?.name || '',
                    call_duration: msg._data?.callDuration || 0,
                    call_status: msg._data?.callOutcome || 'UNKNOWN',
                    is_video: !!msg._data?.isVideoCall,
                    call_media_type: msg._data?.isVideoCall ? 'video' : 'audio',
                    group_chat: chat.isGroup,
                    group_id: chat.isGroup ? chat.id._serialized : null,
                    group_name: chat.isGroup ? chat.name : null,
                    message_body: msg.body || ''
                };

                const size = Buffer.byteLength(JSON.stringify(payload));

                if(currentChunk.length && currentSize+size > MAX_PAYLOAD_SIZE) {
                    await safeWebhook('CALL_LOG_SYNC',
                        {
                            userId,
                            chunkNumber,
                            callLogs: currentChunk
                        },
                        webhookUrl
                    );

                    currentChunk = [];
                    currentSize = 0;
                    chunkNumber++;

                }

                currentChunk.push(payload);
                currentSize += size;
            }
        }catch(err) {
            logger.error(err.message);
        }
    }

    if(currentChunk.length) {
        await safeWebhook('CALL_LOG_SYNC',
            {
                userId,
                chunkNumber,
                callLogs: currentChunk
            },
            webhookUrl
        );
    }
};