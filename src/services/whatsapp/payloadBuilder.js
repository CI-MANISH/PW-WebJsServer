const logger = require('../../config/logger');
const { extractNumber, resolveNumber, getMentionId, getMediaData, safeAsync } = require('./whatsappUtils');

async function createMessagePayload(msg, chat, myNumber, profilePicUrl) {
    const isFromMe = msg.fromMe;
    const myMobile = resolveNumber(myNumber) || extractNumber(myNumber);

    let customerNumber = '';
    let quotedMessageId = null;

    try {
        const contact = await chat.getContact();

        if (msg.hasQuotedMsg) {
            const quoted = await msg.getQuotedMessage();
            quotedMessageId = quoted?.id?.id || quoted?.id?._serialized || null;
        }

        // ==========================================
        // FIX 1: HANDLE BOTH INBOUND & OUTBOUND FOR GROUPS
        // ==========================================
        if (chat.isGroup) {
            const participantId = isFromMe 
                ? (msg.from || chat.client.info?.wid?._serialized)
                : (msg.author || msg._data?.author || msg._data?.participant || null);

            try {
                let participantContact = null;
                if (participantId) {
                    participantContact = await chat.client.getContactById(participantId);
                }

                // Customer Number assignment for group context
                customerNumber = extractNumber(participantContact?.id?._serialized || participantContact?._serialized || '') || 
                                 participantContact?.number || 
                                 extractNumber(participantId);
            } catch (e) {
                customerNumber = extractNumber(participantId) || myMobile;
            }
        } else {
            // Normal Individual Chat
            const rawNumber = contact?.id?._serialized || contact?.number || msg.from || msg.to || chat.id?._serialized;
            customerNumber = resolveNumber(rawNumber);
        }
    } catch (e) {
        customerNumber = resolveNumber(isFromMe ? msg.to : msg.from);
    }

    let mentionedIds = [];
    let messageBody = msg.body || msg.caption || msg._data?.caption || '';

    // Mentions Lookup (LID Proofed as updated before)
    if (msg.mentionedIds?.length) {
        for (const id of msg.mentionedIds) {
            try {
                const targetId = typeof id === 'object' ? (id._serialized || `${id.user}@${id.server}`) : id;
                if (!targetId) continue;

                const contact = await chat.client.getContactById(targetId);
                const mobile = extractNumber(contact?.id?._serialized || '') || contact?.number || '';
                mentionedIds.push({
                    id: targetId,
                    mobile,
                    name: contact?.pushname || contact?.name || null
                });
            } catch (e) {
                console.log('MENTION LOOKUP FAILED =>', e.message);
                const stringId = typeof id === 'object' ? (id._serialized || id.user || '') : id;
                mentionedIds.push({ id, mobile: extractNumber(stringId), name: null });
            }
        }

        for (const mention of mentionedIds) {
            const mentionKey = getMentionId(mention.id);
            messageBody = messageBody.replace(`@${mentionKey}`, `@${mention.mobile}`);
        }
    }

    let mediaData = null;
    if (msg.hasMedia) {
        mediaData = await getMediaData(msg);
    }

    let locationData = null;
    if (msg.type === 'location') {
        locationData = {
            latitude: msg.location?.latitude || msg._data?.lat || null,
            longitude: msg.location?.longitude || msg._data?.lng || null,
            name: msg.location?.name || msg._data?.loc || null,
            address: msg.location?.address || null
        };
    }

    let groupInfo = null;
    let participantInfo = null;
    let senderParticipant = null;

    if (chat.isGroup) {
        try {
            const groupChat = await chat.client.getChatById(chat.id._serialized);

            participantInfo = await Promise.all(
                groupChat.participants.map(async (p) => {
                    try {
                        const contact = await chat.client.getContactById(p.id._serialized);
                        return {
                            mobile: contact?.number || extractNumber(p.id._serialized),
                            name: contact?.pushname || contact?.name || null,
                            isAdmin: p.isAdmin || false,
                            isSuperAdmin: p.isSuperAdmin || false
                        };
                    } catch (e) {
                        return {
                            mobile: extractNumber(p.id._serialized),
                            name: null,
                            isAdmin: p.isAdmin || false,
                            isSuperAdmin: p.isSuperAdmin || false
                        };
                    }
                })
            );

            // ==========================================
            // FIX 2: FIND SENDER IN PARTICIPANTS FOR BOTH INBOUND & OUTBOUND
            // ==========================================
            senderParticipant = participantInfo.find(p => p.mobile === customerNumber) || null;

            if (!senderParticipant && isFromMe) {
                senderParticipant = {
                    mobile: myMobile,
                    name: 'Me (System)',
                    isAdmin: false,
                    isSuperAdmin: false
                };
            }

            groupInfo = {
                group_chat: true,
                group_id: chat.id._serialized,
                group_name: chat.name,
                participants_count: participantInfo.length
            };
        } catch (e) {
            logger.error(`[GROUP INFO] ${e.message}`);
        }
    }

    // Fallback assignment
    if (chat.isGroup && !customerNumber) {
        customerNumber = senderParticipant?.mobile || myMobile;
    }

    const cleanMyNumber = myMobile || '';

    // ==========================================
    // PERFECT FIXED GROUP MAPPING (TAGS + GROUPS HANDLING)
    // ==========================================
    let finalSender = '';
    let finalRecipient = '';
    let finalCustomer = '';

    if (chat.isGroup) {
        if (isFromMe) {
            finalSender = cleanMyNumber;
        } else {
            finalSender = customerNumber || extractNumber(msg.author) || extractNumber(msg.from); // Kisi aur member ne bheja
        }

        if (mentionedIds && mentionedIds.length > 0) {
            const taggedUser = mentionedIds[0].mobile; 
            
            finalRecipient = taggedUser;
            finalCustomer = taggedUser;
        } else if (msg.hasQuotedMsg && quotedMessageId && customerNumber && customerNumber !== cleanMyNumber) {
            finalRecipient = customerNumber;
            finalCustomer = customerNumber;
        } else {
            finalRecipient = chat.id._serialized;
            finalCustomer = chat.id._serialized;
        }

    } else {
        // --- INDIVIDUAL CHAT LOGIC (1-to-1 Normal Chat) ---
        finalCustomer = customerNumber;
        finalSender = isFromMe ? cleanMyNumber : customerNumber;
        finalRecipient = isFromMe ? customerNumber : cleanMyNumber;
    }

    // Dynamic clean fallback verification
    const cleanSender = finalSender || cleanMyNumber;
    const cleanRecipient = finalRecipient || chat.id._serialized;
    const cleanCustomerField = finalCustomer || chat.id._serialized;

    return {
        direction: isFromMe ? 'Outbound' : 'Inbound',
        direction_code: isFromMe ? 1 : 0,
        chat_room_name: chat.name || 'Unknown Group/Chat',
        
        sender_number: cleanSender,
        recipient_number: cleanRecipient,
        customer_number: cleanCustomerField,

        participant_number: chat.isGroup ? (customerNumber || extractNumber(msg.author) || cleanSender) : cleanCustomerField,
        participant_name: senderParticipant?.name || (isFromMe ? 'Me' : null),

        message_id: msg.id.id || msg.id._serialized,
        message_body: messageBody,
        message_type: msg.type === 'chat' ? 'text' : msg.type,
        media: mediaData,
        location: locationData,
        timestamp: String(msg.timestamp),
        profile_pic_url: profilePicUrl || '',
        is_starred: !!(msg.isStarred || msg._data?.star || msg._data?.isStarred || false),
        reply_to_message_id: quotedMessageId,
        mentioned_ids: mentionedIds,
        group_chat: chat.isGroup || false,
        
        group: groupInfo || {
            group_chat: chat.isGroup,
            group_id: chat.id._serialized,
            group_name: chat.name || 'Unknown Group',
            participants_count: 0
        }
    };
}

module.exports = { createMessagePayload };