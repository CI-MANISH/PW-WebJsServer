const path = require('path');
const fs = require('fs');
const logger = require('../../config/logger');

function getSessionsPath() {
    const isVercel = process.env.VERCEL === '1';
    const basePath = process.env.SESSION_STORAGE_PATH ||
        (
            isVercel
                ? '/tmp/sessions'
                : path.join(process.cwd(), 'sessions')
        );

    if (!fs.existsSync(basePath)) {
        fs.mkdirSync(basePath, { recursive: true });
    }
    return basePath;
}

function getMentionId(id) {
    if (!id) return '';
    if (typeof id === 'string') return id.split('@')[0];
    return id.user || '';
}

function extractNumber(id = '') {
    if (!id) return '';
    if (typeof id === 'object') {
        id = id._serialized || id.user || '';
    }
    return String(id).split('@')[0].split(':')[0];
}

async function safeAsync(fn, label = 'ERROR') {
    try {
        return await fn();
    } catch (err) {
        logger.error(`[${label}] ${err.message}`);
        return null;
    }
}

function safeEvent(handler, label = 'EVENT') {
    return async (...args) => {
        try {
            await handler(...args);
        } catch (err) {
            logger.error(`[${label}] ${err.message}`);
        }
    };
}

function resolveNumber(raw = '') {
    if (!raw) return '';
    const clean = raw.toString().split('@')[0].split(':')[0];

    const isMasked = clean.startsWith('93433');
    const isLongToken = clean.length > 14;
    const isNumericToken = /^\d{15,}$/.test(clean);

    if (isMasked || isLongToken || isNumericToken) {
        return '';
    }
    return clean;
}

async function getMediaData(msg) {
    try {
        if (!msg?.hasMedia) return null;
        let media = null;

        for (let i = 0; i < 3; i++) {
            try {
                media = await msg.downloadMedia();
                if (media) break;
            } catch (e) {
                logger.warn(`[MEDIA RETRY ${i + 1}] ${e.message}`);
            }
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        if (!media) {
            return {
                pending: true,
                messageType: msg.type || null,
                mimetype: msg._data?.mimetype || null,
                filename: msg._data?.filename || null,
                filesize: Number(msg._data?.size || 0),
                base64: null
            };
        }

        const MAX_VIDEO_SIZE = 20 * 1024 * 1024;
        const mimeType = media.mimetype || msg._data?.mimetype || null;
        const fileSize = Number(media.filesize || msg._data?.size || 0);
        const fileName = media.filename || msg._data?.filename || null;
        let base64Data = media.data || null;

        if (mimeType?.startsWith('video/') && fileSize > MAX_VIDEO_SIZE) {
            logger.warn(`[LARGE VIDEO SKIPPED] ${fileSize} bytes`);
            base64Data = null;
        }

        return {
            messageType: msg.type || null,
            mediaCategory: msg.type === 'ptt' ? 'voice_note' : msg.type,
            mimetype: mimeType,
            filename: fileName,
            filesize: fileSize,
            base64: base64Data,
            isVoiceNote: msg.type === 'ptt',
            hasMedia: true
        };
    } catch (err) {
        logger.error(`[MEDIA DOWNLOAD ERROR] ${err.message}`);
        return {
            error: true,
            message: err.message,
            messageType: msg?.type || null,
            mimetype: msg?._data?.mimetype || null
        };
    }
}

module.exports = {
    getSessionsPath,
    getMentionId,
    extractNumber,
    safeAsync,
    safeEvent,
    resolveNumber,
    getMediaData
};