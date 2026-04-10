import { DateTime } from "luxon";
import { saveConfig } from "./configManager.js";
import { broadcastToUsers } from "./userBroadcast.js";
import { sendMediaGroupContent } from "./mediaGroupHandler.js";
import { safeMarkdownV2 } from "./utils.js";

export const scheduleMessage = async ({ messageId, content, time, channels, pin, isBroadcast }, bot, config) => {
    try {
        const scheduleTime = new Date(time);
        const now = DateTime.now().setZone("Asia/Yekaterinburg").toJSDate();
        const delay = scheduleTime.getTime() - now.getTime();

        console.log("Планирование сообщения:", {
            messageId,
            time: scheduleTime.toISOString(),
            localTime: DateTime.fromJSDate(scheduleTime).setZone("Asia/Yekaterinburg").toLocaleString(DateTime.DATETIME_FULL),
            now: now.toISOString(),
            nowLocal: DateTime.fromJSDate(now).setZone("Asia/Yekaterinburg").toLocaleString(DateTime.DATETIME_FULL),
            delay,
            channels,
            pin,
            isBroadcast,
            contentType: content.text ? "текст" : content.mediaGroup ? "медиа-группа" : content.media ? "медиа" : "неизвестно",
            contentDetails: content.mediaGroup
                ? `медиа-группа (сообщений: ${content.mediaGroup.length})`
                : content.media
                    ? `медиа (${content.media.photo ? "фото" : content.media.video ? "видео" : content.media.document ? "документ" : "неизвестно"})`
                    : content.text
                        ? `текст: ${content.text.substring(0, 50)}...`
                        : "нет",
        });

        if (delay <= 0) {
            console.log(`⚠️ Сообщение ${messageId} не запланировано: время прошло`);
            await bot.sendMessage(config.adminChannelId, safeMarkdownV2(`⚠️ Сообщение ${messageId} не отправлено: время ${DateTime.fromJSDate(scheduleTime).setZone("Asia/Yekaterinburg").toLocaleString(DateTime.DATETIME_FULL)} прошло`), {
                parse_mode: "MarkdownV2",
                reply_markup: {
                    keyboard: [
                        [{ text: "📅 Создать отложенное сообщение" }, { text: "📩 Рассылка пользователям" }],
                        [{ text: "📬 Запланировать рассылку" }, { text: "📋 Список каналов" }],
                        [{ text: "👥 Список пользователей" }, { text: "🗑 Удалить канал" }],
                        [{ text: "➕ Добавить канал" }, { text: "🚫 Разбанить" }],
                        [{ text: "🆔 Получить ID чата" }, { text: "📜 Список отложенных сообщений" }]
                    ],
                    resize_keyboard: true,
                    persistent: true
                }
            });
            return;
        }

        config.scheduledMessages = config.scheduledMessages || [];
        config.scheduledMessages.push({ messageId, content, scheduleTime: scheduleTime.toISOString(), channels, pin, isBroadcast });
        await saveConfig(config);
        console.log(`Таймер установлен для ${messageId} на ${scheduleTime.toISOString()}`);
    } catch (error) {
        console.error(`❌ Ошибка планирования сообщения ${messageId}: ${error.message}`);
        await bot.sendMessage(config.adminChannelId, safeMarkdownV2(`❌ Ошибка планирования сообщения ${messageId}: ${error.message}`), {
            parse_mode: "MarkdownV2",
            reply_markup: {
                keyboard: [
                    [{ text: "📅 Создать отложенное сообщение" }, { text: "📩 Рассылка пользователям" }],
                    [{ text: "📬 Запланировать рассылку" }, { text: "📋 Список каналов" }],
                    [{ text: "👥 Список пользователей" }, { text: "🗑 Удалить канал" }],
                    [{ text: "➕ Добавить канал" }, { text: "🚫 Разбанить" }],
                    [{ text: "🆔 Получить ID чата" }, { text: "📜 Список отложенных сообщений" }]
                ],
                resize_keyboard: true,
                persistent: true
            }
        });
    }
};