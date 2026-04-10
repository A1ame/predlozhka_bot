import { saveConfig } from './configManager.js';
import { sendMediaGroupContent } from './mediaGroupHandler.js';
import { safeMarkdownV2 } from './utils.js';

export const sendMessageToMainAdmin = async (bot, mainAdminId, pendingMessage, config) => {
    try {
        const { userId, messageId, content, channelCode } = pendingMessage;
        const channelName = config.channels[channelCode]?.name || channelCode;
        const userInfo = await bot.getChat(userId);
        const username = userInfo.username ? `@${safeMarkdownV2(userInfo.username)}` : "без username";

        const infoMessageText = safeMarkdownV2(
            `👤 🆔 ${userId} | ${username} | канал: ${channelName}\nПереслано для проверки главному админу`
        );
        const infoMessage = await bot.sendMessage(
            mainAdminId,
            infoMessageText,
            {
                parse_mode: "MarkdownV2",
                reply_markup: {
                    inline_keyboard: [
                        [
                            { text: "Одобрить", callback_data: `approve|${channelCode}|${userId}|${messageId}` },
                            { text: "Отклонить", callback_data: `reject|${channelCode}|${userId}|${messageId}` }
                        ],
                        [
                            { text: "Одобрить с гайдом", callback_data: `approve_with_guide|${channelCode}|${userId}|${messageId}` },
                            { text: "Бан", callback_data: `ban|${channelCode}|${userId}|${messageId}` }
                        ],
                        [
                            { text: "Переслать главному админу", callback_data: `to_main_admin|${channelCode}|${userId}|${messageId}` },
                            { text: "Запланировать", callback_data: `schedule_pending|${channelCode}|${userId}|${messageId}` }
                        ]
                    ]
                }
            }
        );

        pendingMessage.adminMessageId = infoMessage.message_id;
        config.pendingMessages = config.pendingMessages || [];
        config.pendingMessages.push(pendingMessage);
        await saveConfig(config);
        console.log(`✅ Сообщение ${messageId} от ${userId} отправлено главному админу`);
    } catch (error) {
        console.error(`❌ Ошибка отправки сообщения главному админу: ${error.message}`);
        throw error;
    }
};

export const broadcastToUsers = async (bot, content, config) => {
    try {
        const users = Object.keys(config.users).filter(userId => !config.bannedUsers[userId]);
        console.log(`📩 Рассылка пользователям:`, users);

        for (const userId of users) {
            try {
                await sendMediaGroupContent(bot, userId, content);
                console.log(`✅ Сообщение отправлено пользователю ${userId}`);
            } catch (error) {
                console.error(`❌ Ошибка отправки сообщения пользователю ${userId}: ${error.message}`);
            }
        }
        console.log(`✅ Рассылка завершена для ${users.length} пользователей`);
        await bot.sendMessage(config.adminChannelId, safeMarkdownV2(`✅ Рассылка завершена для ${users.length} пользователей`), {
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
    } catch (error) {
        console.error(`❌ Ошибка рассылки: ${error.message}`);
        await bot.sendMessage(config.adminChannelId, safeMarkdownV2(`❌ Ошибка рассылки: ${error.message}`), {
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
        throw error;
    }
};