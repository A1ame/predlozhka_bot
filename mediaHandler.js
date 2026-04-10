import { DateTime } from 'luxon';

export const handleMediaGroup = async (bot, msg, mediaGroups, userId, callback) => {
    const mediaGroupId = msg.media_group_id;
    if (!mediaGroupId) {
        return callback(msg);
    }

    mediaGroups[userId] = mediaGroups[userId] || {};
    mediaGroups[userId][mediaGroupId] = mediaGroups[userId][mediaGroupId] || [];
    mediaGroups[userId][mediaGroupId].push(msg);

    if (mediaGroups[userId][mediaGroupId].length === 1) {
        setTimeout(async () => {
            if (mediaGroups[userId]?.[mediaGroupId]) {
                const content = {
                    mediaGroup: mediaGroups[userId][mediaGroupId].map(m => ({
                        message_id: m.message_id,
                        photo: m.photo,
                        video: m.video,
                        document: m.document,
                        caption: m.caption || ""
                    }))
                };
                delete mediaGroups[userId][mediaGroupId];
                await callback(content);
            }
        }, 1000);
    }
};

export const sendMediaGroupContent = async (bot, chatId, content, options = {}) => {
    if (content.text) {
        return await bot.sendMessage(chatId, content.text, { parse_mode: "MarkdownV2", ...options });
    } else if (content.media) {
        if (content.media.photo) {
            return await bot.sendPhoto(chatId, content.media.photo[content.media.photo.length - 1].file_id, {
                caption: content.media.caption || "",
                parse_mode: "MarkdownV2",
                ...options
            });
        } else if (content.media.video) {
            return await bot.sendVideo(chatId, content.media.video.file_id, {
                caption: content.media.caption || "",
                parse_mode: "MarkdownV2",
                ...options
            });
        } else if (content.media.document) {
            return await bot.sendDocument(chatId, content.media.document.file_id, {
                caption: content.media.caption || "",
                parse_mode: "MarkdownV2",
                ...options
            });
        }
    } else if (content.mediaGroup) {
        const mediaArray = content.mediaGroup.map(m => {
            let type, media;
            if (m.photo) {
                type = "photo";
                media = m.photo[m.photo.length - 1].file_id;
            } else if (m.video) {
                type = "video";
                media = m.video.file_id;
            } else if (m.document) {
                type = "document";
                media = m.document.file_id;
            }
            return { type, media, caption: m.caption || "", parse_mode: "MarkdownV2" };
        });
        return await bot.sendMediaGroup(chatId, mediaArray, options);
    }
    throw new Error("Неверный формат контента");
};