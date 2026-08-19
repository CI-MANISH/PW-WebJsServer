const { Client, LocalAuth } = require('whatsapp-web.js');
const path = require('path');
const fs = require('fs');

const qrManager = require('./qrManager');
const registry = require('./sessionRegistry');
const { sendWebhook } = require('../salesforce/webhook.service');
const logger = require('../../config/logger');
const { QR_EXPIRY_MS } = require('../../config/env');

const { getSessionsPath, extractNumber, safeAsync, safeEvent } = require('./whatsappUtils');
const { createMessagePayload } = require('./payloadBuilder');

const initializing = new Set();
const destroyedClients = new Set();
const queueMap = new Map();
const timeoutMap = new Map();

const FLUSH_DELAY_MS = 3000;

async function safeWebhook(event, payload, webhookUrl) {
    return safeAsync(async () => sendWebhook(event, payload, webhookUrl), `WEBHOOK ${event}`);
}

async function safeDestroy(client) {
    return safeAsync(async () => client?.destroy(), 'CLIENT DESTROY');
}

function clearMessageQueue(userId) {
    if (timeoutMap.has(userId)) {
        clearTimeout(timeoutMap.get(userId));
        timeoutMap.delete(userId);
    }
    queueMap.delete(userId);
}

function clearQrTimer(session) {
    if (session?.qrTimer) {
        clearTimeout(session.qrTimer);
        session.qrTimer = null;
    }
}

function updateSession(userId, session, updates = {}) {
    Object.assign(session, updates);
    registry.add(userId, session);
    return session;
}

async function removeSessionDirectory(userId) {
    return safeAsync(async () => {
        const sessionDir = path.join(getSessionsPath(), `session-${userId}`);
        if (fs.existsSync(sessionDir)) {
            fs.rmSync(sessionDir, { recursive: true, force: true });
        }
    }, 'REMOVE SESSION DIR');
}

async function cleanupSession(userId, session, client) {
    clearQrTimer(session);
    clearMessageQueue(userId);
    destroyedClients.add(userId);
    await safeDestroy(client);
    registry.remove(userId);
    await removeSessionDirectory(userId);
}

async function buildClient(userId) {
    return new Client({
        authStrategy: new LocalAuth({
            clientId: userId,
            dataPath: getSessionsPath()
        }),

        webVersionCache: {
            type: 'remote',
            remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1018940428-alpha.html'
        },

        puppeteer: {
            headless: 'shell',
            executablePath: process.env.CHROME_PATH || undefined,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-gpu',
                '--disable-software-rasterizer',
                '--disable-2d-canvas-clip-utils',
                '--disable-gl-drawing-for-tests',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--single-process',
                '--blink-settings=imagesEnabled=false',
                '--disable-remote-fonts',
                '--disable-background-networking',
                '--disable-background-timer-throttling',
                '--disable-client-side-phishing-detection',
                '--disable-default-apps',
                '--disable-extensions',
                '--disable-hang-monitor',
                '--disable-popup-blocking',
                '--disable-prompt-on-repost',
                '--disable-sync',
                '--disable-translate',
                '--metrics-recording-only',
                '--mute-audio',
                '--no-default-browser-check',
                '--safebrowsing-disable-auto-update',
                '--js-flags="--expose-gc --max-old-space-size=256"'
            ],
            protocolTimeout: 300000
        }
    });
}

async function createSession(userId, syncDays = 0, webhookUrl) {
    if (!userId) {
        throw new Error('userId required');
    }

    if (registry.has(userId)) {
        const existingSession = registry.get(userId);
        
        if (!existingSession.connected) {
            logger.warn(`[RE-INIT PROTECTION] Found disconnected/expired registry for ${userId}. Forcing absolute cleanup...`);
            clearQrTimer(existingSession);
            await safeDestroy(existingSession.client);
            registry.remove(userId);
        } else {
            return existingSession;
        }
    }
    
    if (initializing.has(userId)) {
        return;
    }

    initializing.add(userId);
    destroyedClients.delete(userId);
    clearMessageQueue(userId);

    try {
        const client = await buildClient(userId);
        const session = {
            userId,
            client,
            syncDays,
            connected: false,
            qrCode: null,
            qrTimer: null,
            phoneNumber: null,
            lastActive: Date.now(),
            disconnectHandled: false,
            readyHandled: false,
            isLoggingOut: false,
            qrLocked: false,
            webhookUrl,
            state: null
        };

        registry.add(userId, session);

        client.on('qr', safeEvent(async (qr) => {
            if (session.qrCode && session.qrLocked) {
                return;
            }
            session.qrLocked = true;

            const qrCode = await qrManager.generate(qr);
            updateSession(userId, session, {
                qrCode,
                connected: false,
                lastActive: Date.now()
            });

            await safeWebhook('QR_GENERATED', { userId, qrCode }, session.webhookUrl);
            clearQrTimer(session);

            session.qrTimer = setTimeout(
                safeEvent(async () => {
                    logger.warn(`[QR EXPIRED] ${userId}`);
                    updateSession(userId, session, { qrCode: null, connected: false, qrLocked: false });
                    await safeWebhook('SESSION_INACTIVE', { userId, status: 'QR_EXPIRED', actionRequired: true }, session.webhookUrl);

                    if (!session.connected) {
                        await cleanupSession(userId, session, client);
                    }
                }, 'QR TIMER'),
                QR_EXPIRY_MS
            );
        }, 'QR EVENT'));

        client.on('ready', safeEvent(async () => {
            logger.info(`[SYNC CHECK] userId=${userId} syncDays=${session.syncDays}`);
            if (session.isLoggingOut || session.disconnectHandled || destroyedClients.has(userId)) return;

            session.disconnectHandled = false;
            clearQrTimer(session);
            session.qrLocked = false;
            session.qrCode = null;

            updateSession(userId, session, {
                readyHandled: true,
                connected: true,
                disconnectHandled: false,
                qrLocked: false,
                qrCode: null,
                phoneNumber: client.info?.wid?.user || null,
                lastActive: Date.now()
            });

            // Resource optimization for multi-tenant high CPU load
            try {
                if (client.pupPage && !client.pupPage.isClosed()) {
                    await client.pupPage.setRequestInterception(true).catch(() => {});
                    client.pupPage.on('request', (req) => {
                        if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType())) {
                            req.abort().catch(() => {});
                        } else {
                            req.continue().catch(() => {});
                        }
                    });
                }
            } catch (resErr) {
                // Ignore silent resource interception errors
            }

            await safeWebhook('CONNECTED', { userId, phoneNumber: session.phoneNumber }, session.webhookUrl);

            console.log(`[DOM SETTLING] Waiting 3s for WhatsApp Web models to initialize...`);
            await new Promise(resolve => setTimeout(resolve, 3000));

            let chats = [];
            try {
                chats = await client.getChats();
            } catch (err) {
                logger.error(`[GET CHATS ERROR] ${err.message}`);
                chats = [];
            }

            console.log(`[GET CHATS SUCCESS] Total Chats Found: ${Array.isArray(chats) ? chats.length : 0}`);

            // GROUP SYNC SECTION
            try {
                const groupChats = (chats || []).filter(chat => chat && chat.isGroup);
                logger.info(`[GROUP SYNC STARTED] Total Groups Found: ${groupChats.length} for userId=${userId}`);
                
                const MAX_GROUPS_PER_CHUNK = 5;
                let currentGroupChunk = [];
                let groupChunkNumber = 1;

                for (const chat of groupChats) {
                    try {
                        const resolvedParticipants = [];
                        for (const p of (chat.participants || [])) {
                            try {
                                const targetId = p.id?._serialized || p.id || '';
                                if (!targetId) continue;

                                const contact = await client.getContactById(targetId).catch(() => null);
                                const rawTargetNumber = contact?.id?._serialized || contact?._serialized || targetId;
                                
                                resolvedParticipants.push({
                                    mobile: extractNumber(rawTargetNumber),
                                    name: contact?.pushname || contact?.name || 'Group Member',
                                    isAdmin: !!p.isAdmin,
                                    isSuperAdmin: !!p.isSuperAdmin
                                });
                            } catch (pErr) {
                                resolvedParticipants.push({
                                    mobile: extractNumber(p.id?._serialized || ''),
                                    name: 'Group Member',
                                    isAdmin: !!p.isAdmin,
                                    isSuperAdmin: !!p.isSuperAdmin
                                });
                            }
                        }

                        currentGroupChunk.push({
                            group_id: chat.id._serialized,
                            group_name: chat.name,
                            participants_count: resolvedParticipants.length,
                            participants: resolvedParticipants
                        });

                        if (currentGroupChunk.length >= MAX_GROUPS_PER_CHUNK) {
                            logger.info(`[SENDING GROUP SYNC CHUNK] Chunk #${groupChunkNumber} for userId=${userId}`);
                            
                            await safeWebhook('GROUP_SYNC', { 
                                userId, 
                                chunkNumber: groupChunkNumber,
                                totalChunks: Math.ceil(groupChats.length / MAX_GROUPS_PER_CHUNK),
                                groups: currentGroupChunk 
                            }, session.webhookUrl);

                            groupChunkNumber++;
                            currentGroupChunk = [];

                            await new Promise(resolve => setTimeout(resolve, 1000));
                        } else {
                            await new Promise(resolve => setTimeout(resolve, 200));
                        }

                    } catch (groupErr) {
                        logger.error(`[SYNC SINGLE CHAT ERROR] Group=${chat.name} : ${groupErr.message}`);
                    }
                }

                if (currentGroupChunk.length > 0) {
                    logger.info(`[SENDING FINAL GROUP SYNC CHUNK] Chunk #${groupChunkNumber} for userId=${userId}`);
                    await safeWebhook('GROUP_SYNC', { 
                        userId, 
                        chunkNumber: groupChunkNumber,
                        totalChunks: groupChunkNumber,
                        groups: currentGroupChunk 
                    }, session.webhookUrl);
                }

                logger.info(`[GROUP SYNC DONE] Successfully synced all chunks for userId=${userId}`);

            } catch (err) {
                logger.error(`[GLOBAL GROUP SYNC ERROR] ${err.message}`);
            }

            if (session.syncDays <= 0) return;
            logger.info(`[SYNC STARTED] ${userId}`);

            const syncFromTime = Math.floor(Date.now() / 1000) - (session.syncDays * 86400);
            const MAX_PAYLOAD_SIZE = 1 * 1024 * 1024;

            let currentChunk = [];
            let currentSize = 0;
            let chunkNumber = 1;

            for (const chat of (chats || [])) {
                if (!chat) continue;

                try {
                    const msgs = await chat.fetchMessages({ limit: 100 }).catch(() => []);

                    for (const msg of msgs) {
                        if (!msg || msg.timestamp < syncFromTime) continue;

                        let payload = null;

                        const isCallNotification = 
                            msg.type === 'call_log' || 
                            msg._data?.type === 'call_log' ||
                            (msg.type === 'gp2' && msg._data?.subtype?.includes('call')) ||
                            (msg.type === 'notification' && msg.body?.toLowerCase().includes('call'));

                        if (isCallNotification) {
                            let customerNumber = '';
                            let cleanName = 'Unknown';
                            
                            try {
                                const nativeContact = await chat.getContact().catch(() => null);
                                
                                if (nativeContact && nativeContact.id && nativeContact.id.user && !nativeContact.id._serialized.includes('@lid')) {
                                    customerNumber = nativeContact.id.user;
                                } else if (nativeContact && nativeContact.number && !nativeContact.number.startsWith('1038') && !nativeContact.number.startsWith('1922')) {
                                    customerNumber = nativeContact.number;
                                }

                                if (nativeContact) {
                                    cleanName = nativeContact.name || nativeContact.pushname || nativeContact.shortName || 'Unknown';
                                }
                            } catch (contactErr) {
                                logger.error(`[SYNC CALL LOG NUMBER] getContact extraction failed: ${contactErr.message}`);
                            }

                            if (!customerNumber || customerNumber.length > 15) {
                                const rawFrom = msg.from?._serialized || msg.from || msg._data?.from?._serialized || msg._data?.from || '';
                                const rawTo = msg.to?._serialized || msg.to || msg._data?.to?._serialized || msg._data?.to || '';
                                const rawTargetJid = msg.fromMe ? rawTo : rawFrom;
                                
                                customerNumber = extractNumber(rawTargetJid);
                            }

                            const isFromMe = msg.fromMe;
                            const cleanMyNumber = session.phoneNumber || '';

                            let cleanCustomerField = customerNumber;
                            let cleanSender = isFromMe ? cleanMyNumber : customerNumber;
                            let cleanRecipient = isFromMe ? customerNumber : cleanMyNumber;

                            const rawOutcome = String(msg._data?.callOutcome || '').toLowerCase();
                            let cleanCallStatus = 'MISSED';

                            if (rawOutcome.includes('complete') || rawOutcome.includes('accept')) {
                                cleanCallStatus = isFromMe ? 'COMPLETED' : 'RECEIVED';
                            } else if (rawOutcome.includes('miss')) {
                                cleanCallStatus = 'MISSED';
                            } else if (rawOutcome.includes('reject') || rawOutcome.includes('fail')) {
                                cleanCallStatus = 'REJECTED';
                            } else if ((msg._data?.callDuration || 0) > 0) {
                                cleanCallStatus = isFromMe ? 'COMPLETED' : 'RECEIVED';
                            }

                            const isVideoCall = !!(msg._data?.isVideoCall || msg.body?.toLowerCase().includes('video'));
                            const isVideoCallPayload = isVideoCall;
                            const isGroupChat = !!chat.isGroup;

                            let dynamicBody = msg.body;
                            if (!dynamicBody) {
                                if (isGroupChat) {
                                    dynamicBody = `${isVideoCallPayload ? 'Video' : 'Voice'} Group Call in [${chat.name || 'Unknown Group'}]`;
                                } else {
                                    dynamicBody = `${isVideoCallPayload ? 'Video' : 'Voice'} Call with ${cleanName}`;
                                }
                            }

                            payload = {
                                userId: userId,
                                message_id: msg.id?._serialized || msg.id?.id || String(Math.random()),
                                direction: isFromMe ? 'Outbound' : 'Inbound',
                                message_body: dynamicBody,
                                type: 'call_log',
                                timestamp: String(msg.timestamp),
                                
                                sender_number: cleanSender,
                                recipient_number: cleanRecipient,
                                customer_number: cleanCustomerField,
                                customer_name: cleanName,

                                is_video: isVideoCallPayload, 
                                call_media_type: isVideoCallPayload ? 'video' : 'audio',

                                group_chat: isGroupChat,
                                group_id: isGroupChat ? chat.id._serialized : null,
                                group_name: isGroupChat ? (chat.name || 'Unknown Group') : null,
                                
                                call_duration: msg._data?.callDuration || msg.duration || 0,
                                call_status: cleanCallStatus
                            };
                        } else {
                            payload = await createMessagePayload(msg, chat, session.phoneNumber, '').catch(() => null);
                            if (payload) payload.userId = userId;
                        }

                        if (!payload) continue;

                        const payloadSize = Buffer.byteLength(JSON.stringify(payload), 'utf8');

                        if (currentChunk.length && currentSize + payloadSize > MAX_PAYLOAD_SIZE) {
                            await safeWebhook('MESSAGE_SYNC', { userId, syncDays: session.syncDays, chunkNumber, messagesList: currentChunk }, session.webhookUrl);
                            chunkNumber++;
                            currentChunk = [];
                            currentSize = 0;
                            await new Promise(resolve => setTimeout(resolve, 1000));
                        }
                        currentChunk.push(payload);
                        currentSize += payloadSize;
                    }
                } catch (err) {
                    logger.error(`[SYNC CHAT] ${err.message}`);
                }
            }

            if (currentChunk.length) {
                await safeWebhook('MESSAGE_SYNC', { userId, syncDays: session.syncDays, chunkNumber, messagesList: currentChunk }, session.webhookUrl);
            }
            logger.info(`[SYNC DONE] ${userId}`);
        }, 'READY EVENT'));

        client.on('group_join', safeEvent(async (notification) => {
            const chat = await notification.getChat();

            let rawRecipients = notification.recipientIds || notification.recipients || [];
            if (!Array.isArray(rawRecipients) && rawRecipients) rawRecipients = [rawRecipients];
            if (rawRecipients.length === 0) {
                const participantBackup = notification.id?.participant || notification.author || null;
                if (participantBackup) rawRecipients = [participantBackup];
            }
            const resolvedParticipants = await Promise.all(
                rawRecipients.map(async (pId) => {
                    try {
                        const targetId = typeof pId === 'object' ? (pId._serialized || `${pId.user}@${pId.server}`) : pId;
                        if (!targetId) return null;

                        const contact = await client.getContactById(targetId);
                        const groupParticipant = chat.participants?.find(cp => cp.id._serialized === targetId);

                        const rawTargetNumber = contact?.id?._serialized || contact?._serialized || targetId;
                        return {
                            mobile: extractNumber(rawTargetNumber), 
                            name: contact?.pushname || contact?.name || 'New Member',
                            isAdmin: groupParticipant ? !!groupParticipant.isAdmin : false,
                            isSuperAdmin: groupParticipant ? !!groupParticipant.isSuperAdmin : false
                        };
                    } catch (e) {
                        return {
                            mobile: extractNumber(pId),
                            name: 'New Member',
                            isAdmin: false,
                            isSuperAdmin: false
                        };
                    }
                })
            );

            const cleanParticipants = resolvedParticipants.filter(Boolean);

            const webhookPayload = {
                userId: userId,
                group_id: chat.id._serialized,
                group_name: chat.name,
                author: extractNumber(notification.author || null),
                participants: JSON.stringify(cleanParticipants),
                participants1: cleanParticipants,
                timestamp: Date.now()
            };

            await safeWebhook('GROUP_PARTICIPANT_ADDED', 
                webhookPayload, 
                session.webhookUrl
            );
        }, 'GROUP_JOIN'));

        client.on('group_leave', safeEvent(async (notification) => {
            const chat = await notification.getChat();
            let rawRecipients = notification.recipientIds || notification.recipients || [];

            if (!Array.isArray(rawRecipients) && rawRecipients) rawRecipients = [rawRecipients];

            if (rawRecipients.length === 0) {
                const participantBackup = notification.id?.participant || notification.author || null;
                if (participantBackup) rawRecipients = [participantBackup];
            }

            const resolvedParticipants = await Promise.all(
                rawRecipients.map(async (pId) => {
                    try {
                        const targetId = typeof pId === 'object' ? (pId._serialized || `${pId.user}@${pId.server}`) : pId;

                        if (!targetId) return null;

                        const contact = await client.getContactById(targetId);
                        const rawTargetNumber = contact?.id?._serialized || contact?._serialized || targetId;

                        return {
                            mobile: extractNumber(rawTargetNumber),
                            name: contact?.pushname || contact?.name || 'Removed Member',
                            isAdmin: false,
                            isSuperAdmin: false
                        };
                    } catch (e) {
                        return {
                            mobile: extractNumber(pId),
                            name: 'Removed Member',
                            isAdmin: false,
                            isSuperAdmin: false
                        };
                    }
                })
            );

            const cleanParticipants = resolvedParticipants.filter(Boolean);

            const webhookPayloadLeave = {
                userId: userId,
                group_id: chat.id._serialized,
                group_name: chat.name,
                author: extractNumber(notification.author || null),
                participants: JSON.stringify(cleanParticipants),
                participants1: cleanParticipants,
                timestamp: Date.now()
            };

            await safeWebhook('GROUP_PARTICIPANT_REMOVED', 
                webhookPayloadLeave, 
                session.webhookUrl
            );
        }, 'GROUP_LEAVE'));

        client.on('group_update', safeEvent(async (notification) => {
            const chat = await notification.getChat();
            if (notification.type === 'leave' || notification.type === 'remove') {
                let leftUserRaw = notification.id?.participant || notification.author || null;

                if (leftUserRaw) {
                    try {
                        const targetId = typeof leftUserRaw === 'object' ? (leftUserRaw._serialized || `${leftUserRaw.user}@${leftUserRaw.server}`) : leftUserRaw;
                        const contact = await client.getContactById(targetId);

                        const leftParticipantDetails = [{
                            mobile: contact?.number || extractNumber(targetId),
                            name: contact?.pushname || contact?.name || null,
                            isAdmin: false,
                            isSuperAdmin: false
                        }];
                        await safeWebhook('GROUP_PARTICIPANT_REMOVED',
                            {
                                userId,
                                group_id: chat.id._serialized,
                                group_name: chat.name,
                                author: extractNumber(targetId),
                                participants: leftParticipantDetails,
                                timestamp: Date.now()
                            },
                            session.webhookUrl
                        );
                        return;
                    } catch (err) {
                        logger.error(`[SELF LEAVE PARSING ERROR] ${err.message}`);
                    }
                }
            }
            await safeWebhook('GROUP_UPDATED',
                {
                    userId,
                    group_id: chat.id._serialized,
                    group_name: chat.name,
                    description: chat.groupMetadata?.desc || null,
                    type: notification.type,
                    timestamp: Date.now()
                },
                session.webhookUrl
            );

        }, 'GROUP_UPDATE'));

        client.on('message_create', safeEvent(async (msg) => {
            if (!msg || destroyedClients.has(userId)) return;
            session.lastActive = Date.now();

            let chat = null;
            try {
                chat = await msg.getChat();
            } catch (e) {
                logger.error(`[GET CHAT] ${e.message}`);
                return;
            }

            const myNumber = client.info?.wid?.user;
            if (!myNumber) return;

            let profilePicUrl = '';
            const contact = await safeAsync(async () => client.getContactById(chat.id._serialized), 'GET CONTACT');
            if (contact) {
                profilePicUrl = await safeAsync(async () => contact.getProfilePicUrl(), 'PROFILE PIC') || '';
            }

            const payload = await createMessagePayload(msg, chat, myNumber, profilePicUrl);
            payload.userId = userId;

            if (!queueMap.has(userId)) queueMap.set(userId, []);
            queueMap.get(userId).push(payload);
            clearTimeout(timeoutMap.get(userId));

            const timer = setTimeout(
                safeEvent(async () => {
                    const batch = queueMap.get(userId) || [];
                    if (!batch.length) return;
                    queueMap.set(userId, []);
                    await safeWebhook('MESSAGE_BATCH', { userId, messagesList: batch }, session.webhookUrl);
                }, 'MESSAGE FLUSH'),
                FLUSH_DELAY_MS
            );
            timeoutMap.set(userId, timer);
        }, 'MESSAGE EVENT'));

        client.on('media_uploaded', safeEvent(async (msg) => {
            if (!msg || destroyedClients.has(userId)) return;
            const chat = await msg.getChat();
            const payload = await createMessagePayload(msg, chat, session.phoneNumber, '');
            payload.userId = userId;
            await safeWebhook('MEDIA_UPLOADED', payload, session.webhookUrl);
        }, 'MEDIA_UPLOADED'));

        client.on('message_reaction', safeEvent(async (reaction) => {
            session.lastActive = Date.now();
            await safeWebhook('MESSAGE_REACTION', { userId, reaction: reaction?.reaction || reaction?.msg?.body || null, parent_message_id: reaction?.msgId?.id || reaction?.msgId?._serialized || null, reaction_message_id: reaction?.id?.id || reaction?.id?._serialized || null, sender: reaction?.senderId || null, timestamp: Date.now() }, session.webhookUrl);
        }, 'MESSAGE_REACTION'));

        client.on('message_edit', safeEvent(async (msg, newBody, prevBody) => {
            session.lastActive = Date.now();
            await safeWebhook('MESSAGE_EDITED', { userId, message_id: msg?.id?.id || msg?.id?._serialized || null, old_message: prevBody || msg?.body || null, new_message: newBody || msg?.body || null, timestamp: Date.now() }, session.webhookUrl);
        }, 'MESSAGE_EDIT'));

        client.on('message_revoke_everyone', safeEvent(async (after, before) => {
            session.lastActive = Date.now();
            const target = before || after;

            if (!target) return;

            const msgId = target.id?._serialized || after?.id?._serialized || target.id?.id || null;
            const deletedBody = target.body || "Message content not available in cache";

            let extractedSender = null;
            const rawAuthor = target.author || target.from || null;
            if (rawAuthor) {
                extractedSender = typeof rawAuthor === 'object' 
                    ? (rawAuthor._serialized || `${rawAuthor.user}@${rawAuthor.server}`) 
                    : rawAuthor;
                extractedSender = typeof extractNumber === 'function' ? extractNumber(extractedSender) : String(extractedSender).split('@')[0].split(':')[0];
            }

            await safeWebhook('MESSAGE_DELETED',
                {
                    userId,
                    delete_type: 'everyone',
                    message_id: msgId,
                    deleted_message: deletedBody,
                    sender: extractedSender,
                    timestamp: Date.now()
                },
                session.webhookUrl
            );
        }, 'MESSAGE_REVOKE_EVERYONE'));

        client.on('message_revoke_me', safeEvent(async (msg) => {
            session.lastActive = Date.now();
            await safeWebhook('MESSAGE_DELETED_ME', { userId, delete_type: 'me', message_id: msg?.id?.id || msg?.id?._serialized || null, deleted_message: msg?.body || null, timestamp: Date.now() }, session.webhookUrl);
        }, 'MESSAGE_REVOKE_ME'));

        client.on('message_ack', safeEvent(async (msg) => {
            let status = 'UNKNOWN';
            switch (msg?.ack) {
                case 0: status = 'PENDING'; break;
                case 1: status = 'SENT'; break;
                case 2: status = 'DELIVERED'; break;
                case 3: status = 'READ'; break;
                case 4: status = 'PLAYED'; break;
            }
            await safeWebhook('MESSAGE_STATUS', { userId, message_id: msg?.id?.id || msg?.id?._serialized, ack: msg?.ack, status, timestamp: Date.now() }, session.webhookUrl);
        }, 'MESSAGE_ACK'));

        client.on('call', safeEvent(async (call) => {
            session.lastActive = Date.now();
            
            const rawFrom = call?.from || '';
            const tempCallId = call?.id || '';
            const isVideoCall = !!call?.isVideo;
            const isGroupCall = !!call?.isGroup;
            
            let customerNumber = extractNumber(rawFrom);
            let cleanName = 'Incoming Caller';
            let groupName = null;
            let groupId = null;

            try {
                const contactData = await client.pupPage.evaluate(async (jid) => {
                    try {
                        const contactObj = window.Store?.Contact?.get(jid) || 
                                           window.Store?.Contact?.models?.find(m => m.id?._serialized === jid);
                        
                        if (contactObj) {
                            return {
                                realNumber: contactObj.id?.user || contactObj.phoneNumber || null,
                                name: contactObj.name || contactObj.pushname || contactObj.shortName || null,
                                isGroup: !!contactObj.isGroup
                            };
                        }
                        return null;
                    } catch (e) { return null; }
                }, rawFrom);

                if (contactData) {
                    if (contactData.realNumber) customerNumber = contactData.realNumber;
                    if (contactData.name) cleanName = contactData.name;
                }

                if (isGroupCall) {
                    groupId = rawFrom;
                    const chatObj = await client.getChatById(rawFrom).catch(() => null);
                    if (chatObj) {
                        groupName = chatObj.name || 'Unknown Group Call';
                        cleanName = groupName;
                    }
                }
            } catch (err) {
                logger.error(`[LIVE CALL LOOKUP ERROR] ${err.message}`);
            }

            const uniqueMessageId = `false_${rawFrom.split('@')[0]}@${rawFrom.includes('lid') ? 'lid' : 'c.us'}_${tempCallId}`;

            const callPayload = {
                userId: userId,
                message_id: uniqueMessageId, 
                call_id: tempCallId,
                direction: 'Inbound',
                message_body: isGroupCall 
                    ? `${isVideoCall ? 'Video' : 'Voice'} Incoming Group Call in [${groupName || 'Unknown Group'}] finished (Auto-Rejected)`
                    : `${isVideoCall ? 'Video' : 'Voice'} Incoming call from ${cleanName} finished (Auto-Rejected)`,
                type: 'call_log',
                timestamp: String(Date.now()),

                sender_number: customerNumber,
                recipient_number: session.phoneNumber || '',
                customer_number: customerNumber,
                customer_name: isGroupCall ? 'Group Call' : cleanName,

                is_video: isVideoCall,
                call_media_type: isVideoCall ? 'video' : 'audio',
                
                group_chat: isGroupCall,
                group_id: groupId,
                group_name: groupName,

                call_duration: 0,
                call_status: 'REJECTED'
            };

            await safeWebhook('CALL_RECEIVED', callPayload, session.webhookUrl);

            setTimeout(async () => {
                try {
                    if (call && typeof call.reject === 'function') {
                        await call.reject(); 
                        logger.info(`[CALL AUTO-REJECTED] Headless memory cleared successfully for ID: ${tempCallId}`);
                    }
                } catch (rejectErr) {
                    logger.warn(`[CALL REJECT BYPASS] Call already answered or terminated: ${rejectErr.message}`);
                }
            }, 500);

        }, 'CALL EVENT'));

        client.on('disconnected', safeEvent(async (reason) => {
            clearQrTimer(session);
            if (reason === 'LOGOUT') session.isLoggingOut = true;
            if (session.disconnectHandled) return;

            updateSession(userId, session, { connected: false, readyHandled: false, disconnectHandled: true, qrCode: null, lastActive: Date.now() });

            if (!session.isLoggingOut) {
                await safeWebhook('SESSION_DISCONNECTED', { userId, reason, actionRequired: true, timestamp: new Date().toISOString() }, session.webhookUrl);
            }

            if (session.isLoggingOut || ['LOGOUT', 'UNPAIRED'].includes(reason)) {
                await cleanupSession(userId, session, client);
            }
        }, 'DISCONNECTED EVENT'));

        client.on('authenticated', safeEvent(async () => {
            clearQrTimer(session);
            session.qrLocked = false;
            updateSession(userId, session, { connected: true, qrCode: null, readyHandled: false, disconnectHandled: false, lastActive: Date.now() });
        }, 'AUTHENTICATED'));

        client.on('auth_failure', safeEvent(async (message) => {
            await safeWebhook('SESSION_EXPIRED', { userId, reason: 'AUTH_FAILURE', message, actionRequired: true, timestamp: new Date().toISOString() }, session.webhookUrl);
            session.isLoggingOut = true;
            await cleanupSession(userId, session, client);
        }, 'AUTH FAILURE'));

        client.on('change_state', safeEvent(async (state) => {
            clearQrTimer(session);
            if (state !== 'UNPAIRED') return;
            updateSession(userId, session, { connected: false, qrCode: null });
            await safeWebhook('SESSION_UNPAIRED', { userId, status: 'UNPAIRED', actionRequired: true }, session.webhookUrl);

            try {
                client.removeAllListeners('change_state');
                client.removeAllListeners('ready');
            } catch (e) {
                // Ignore silent errors
            }

            await cleanupSession(userId, session, client);
        }, 'STATE EVENT'));

        client.on('error', (err) => {
            logger.error(`[CLIENT ERROR] ${err.message}`);
        });

        await client.initialize();
        return session;
    } catch (err) {
        logger.error(`[CREATE SESSION] ${err.message}`);
        throw err;
    } finally {
        initializing.delete(userId);
    }
}

module.exports = { createSession, getSessionsPath };