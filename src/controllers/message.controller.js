const fs = require('fs');
const path = require('path');
const mime = require('mime-types');
const multer = require('multer');
const axios = require('axios');

const { MessageMedia } = require('whatsapp-web.js');
const registry = require('../services/whatsapp/sessionRegistry');
const { success, error } = require('../utils/response');

const upload = multer({
    dest: 'uploads/'
});

exports.upload = upload.single('file');

const SUPPORTED_EXTENSIONS = [
    '.jpg',
    '.jpeg',
    '.png',
    '.gif',
    '.pdf',
    '.mp4',
    '.mov',
    '.avi',
    '.mp3',
    '.wav',
    '.doc',
    '.docx',
    '.xls',
    '.xlsx',
    '.txt',
    '.zip'
];

function isBase64(value = '') {
    if (!value) {
        return false;
    }

    return value
        .toString()
        .trim()
        .startsWith('data:');
}

function isBrowserCrash(err) {
    const message = err?.message || '';

    return (
        message.includes('Target closed') ||
        message.includes('Execution context')
    );
}

async function safeDestroy(client) {
    if (!client) {
        return;
    }

    await client.destroy().catch(destroyErr => {
        console.warn('[DESTROY ERROR]', destroyErr.message);
    });
}

async function sendWhatsappMessage(session, chatId, payload, options) {
    try {
        return await session.client.sendMessage(
            chatId,
            payload,
            options
        );
    } catch (err) {
        console.error('[SEND ERROR]', err.message);
        if (isBrowserCrash(err)) {
            session.connected = false;
            await safeDestroy(session.client);
        }

        throw err;
    }
}

function isUrl(value = '') {
    return (
        value.startsWith('http://') ||
        value.startsWith('https://')
    );
}

function extractCleanDigits(id = '') {
    return String(id).split('@')[0].split(':')[0];
}

function cleanupUploadedFile(file) {
    if (!file?.path) {
        return;
    }

    fs.unlink(file.path, () => {});
}

function validateRequest(body) {
    if (!body.userId) {
        return 'userId required';
    }

    if (!body.to) {
        return 'to required';
    }

    return null;
}

function resolveFile(filePath) {
    if (!filePath) {
        return null;
    }

    let finalPath = path.normalize(filePath.trim()).replace(/^["']|["']$/g, '');

    if (!path.isAbsolute(finalPath)) {
        finalPath = path.resolve(
            process.cwd(),
            finalPath
        );
    }

    if (fs.existsSync(finalPath)) {
        return finalPath;
    }

    for (const ext of SUPPORTED_EXTENSIONS) {
        const testPath = `${finalPath}${ext}`;

        if (fs.existsSync(testPath)) {
            return testPath;
        }
    }

    return null;
}

function createBase64Media(base64String) {
    const match = base64String.match(
        /^data:(.+);base64,(.+)$/
    );

    if (!match) {
        throw new Error('Invalid base64 format');
    }

    const mimeType = match[1];
    const base64Data = match[2];

    const extension = mime.extension(mimeType) || 'file';

    return new MessageMedia(
        mimeType,
        base64Data,
        `upload.${extension}`
    );
}

function createFileMedia(filePath) {
    const finalPath = resolveFile(filePath);

    if (!finalPath) {
        throw new Error(`File not found: ${filePath}`);
    }

    return MessageMedia.fromFilePath(
        finalPath
    );
}

function createUploadedMedia(file) {
    if (!file?.path) {
        throw new Error('Uploaded file missing');
    }

    return MessageMedia.fromFilePath(
        file.path
    );
}

async function createUrlMedia(fileUrl) {
    const response = await axios.get(fileUrl,
        {
            responseType: 'arraybuffer',
            timeout:60000
        }
    );

    const mimeType = response.headers['content-type'] || 'application/octet-stream';
    const filename = path.basename(fileUrl.split('?')[0]);
    const fileSize = Number(response.headers['content-length']) || 0;
    let base64 = null;

    if (mimeType.startsWith('video/') && fileSize <= (4 * 1024 * 1024)) {
        base64 = Buffer.from(response.data).toString('base64');
    } else if (!mimeType.startsWith('video/')) {
        base64 = Buffer.from(response.data).toString('base64');
    }

    return new MessageMedia(mimeType, base64, filename);
}

async function createMedia(req, filePath) {
    if (req.file) {
        return createUploadedMedia(req.file);
    }

    if (isBase64(filePath)) {
        return createBase64Media(filePath);
    }

    if (isUrl(filePath)) {
        return createUrlMedia(filePath);
    }

    return createFileMedia(filePath);
}

exports.send = async (req, res) => {
    try {
        const { 
            userId, 
            to, 
            type = 'text', 
            message = '', 
            filePath = '', 
            caption = '', 
            mentions = [], 
            replyToMessageId = null,
            chatType = 'personal',
            groupName = null 
        } = req.body;

        const validationError = validateRequest(req.body);
        if (validationError) {
            return error(res, validationError, 400);
        }

        const session = registry.get(userId);
        if (!session || !session.connected) {
            return error(res, 'WhatsApp not connected', 400);
        }

        let chatId = String(to).trim();
        let groupNameResolved = null;
        const isGroupRequested = (chatType === 'group');

        if (isGroupRequested) {
            console.log(`[GROUP RESOLVER] Searching group named "${groupName}" containing member: ${to}`);
            
            const allChats = await session.client.getChats();
            const activeGroups = allChats.filter(c => c.isGroup);
            const targetMemberClean = extractCleanDigits(chatId);

            const matchedGroup = activeGroups.find(g => {
                const isNameMatch = String(g.name).trim().toLowerCase() === String(groupName).trim().toLowerCase();
                
                const hasMember = g.participants?.some(p => {
                    const participantNum = extractCleanDigits(p.id?._serialized || p.id || '');
                    
                    return participantNum.endsWith(targetMemberClean);
                });

                return isNameMatch && hasMember;
            });

            if (!matchedGroup) {
                console.warn(`[LOOKUP FAILED] No group found named "${groupName}" containing member ${to}`);
                return error(res, `Group validation failed. Could not find any group named "${groupName}" where ${to} is a participant.`, 400);
            }

            chatId = matchedGroup.id._serialized;
            groupNameResolved = matchedGroup.name;
            console.log(`[LOOKUP SUCCESS] Automatically mapped to Real Group JID: ${chatId}`);
        } else {
            let cleanDigits = chatId.replace(/\D/g, '');

            if (cleanDigits.length === 10) {
                cleanDigits = `91${cleanDigits}`;
                console.log(`[ROUTING FIX] 10 digits personal number detected, formatting to: ${cleanDigits}`);
            }

            if (chatId.includes('@')) {
                chatId = chatId;
            } else {
                chatId = `${cleanDigits}@c.us`;
            }
        }

        const isGroup = chatId.endsWith('@g.us');

        const sendOptions = { caption };

        if (replyToMessageId) {
            sendOptions.quotedMessageId = replyToMessageId;
        }

        if (isGroup && Array.isArray(mentions) && mentions.length > 0) {
            const resolvedMentions = [];
            for (let mention of mentions) {
                let cleanMention = String(mention).trim();
                if (!cleanMention.includes('@c.us')) {
                    cleanMention = `${cleanMention}@c.us`;
                }
                resolvedMentions.push(cleanMention);
            }
            sendOptions.mentions = resolvedMentions;
        }

        let sentMessageReceipt = null;

        if (type === 'text') {
            sentMessageReceipt = await sendWhatsappMessage(
                session,
                chatId,
                message,
                sendOptions
            );
        } else {
            if (!req.file && !filePath) {
                return error(res, 'file/filePath required for media assets', 400);
            }

            const media = await createMedia(req, filePath);
            const mimeType = media?.mimetype || '';

            if (
                mimeType.startsWith('application/') ||
                mimeType.includes('pdf') ||
                mimeType.includes('msword') ||
                mimeType.includes('officedocument')
            ) {
                sendOptions.sendMediaAsDocument = true;
            }

            if (mimeType.startsWith('video/')) {
                sendOptions.sendVideoAsGif = false;
            }

            sentMessageReceipt = await sendWhatsappMessage(
                session,
                chatId,
                media,
                sendOptions
            );

            cleanupUploadedFile(req.file);
        }

        const sourcePhoneNum = session.client?.info?.wid?.user || '';
        
        const responseMetadata = {
            message_id: sentMessageReceipt?.id?.id || sentMessageReceipt?.id?._serialized || null,
            direction: 'Outbound',
            type: type === 'text' ? 'text' : sentMessageReceipt?.type || 'media',
            timestamp: Date.now(),
            group_chat: isGroup,
            chat_type: isGroup ? 'group' : 'personal'
        };

        if (isGroup) {
            responseMetadata.group_id = chatId;
            responseMetadata.group_name = groupNameResolved; 
            responseMetadata.customer_number = chatId;
            responseMetadata.recipient_number = chatId;
            responseMetadata.sender_number = sourcePhoneNum;
        } else {
            const targetCleanDigits = extractCleanDigits(chatId);
            responseMetadata.customer_number = targetCleanDigits;
            responseMetadata.recipient_number = targetCleanDigits;
            responseMetadata.sender_number = sourcePhoneNum;
        }

        return success(res, responseMetadata, isGroup ? 'Group message metadata tracking active' : 'Single user outbound triggered');

    } catch (err) {
        console.error('[SEND API FLOW TERMINATED]', err);
        cleanupUploadedFile(req.file);
        return error(res, err.message || 'Internal Server Error');
    }
};