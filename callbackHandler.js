import { saveConfig } from './configManager.js';
import { scheduleMessage } from './messageScheduler.js';
import { sendMediaGroupContent } from './mediaGroupHandler.js';
import { safeMarkdownV2 } from './utils.js';

export const handleCallbackQuery = async (bot, query, userState, scheduledMessages, mediaGroups, config) => {
    const data = query.data;
    const chatId = query.message.chat.id;
    const userId = query.from.id.toString();
    const messageId = query.message.message_id;
    const username = query.from.username ? `@${safeMarkdownV2(query.from.username)}` : "без username";

    console.log(`Обработка callback_query:`, { data, userId, chatId, messageId });

    const adminKeyboard = {
        keyboard: [
            [{ text: "📅 Создать отложенное сообщение" }, { text: "📩 Рассылка пользователям" }],
            [{ text: "📬 Запланировать рассылку" }, { text: "📋 Список каналов" }],
            [{ text: "👥 Список пользователей" }, { text: "🗑 Удалить канал" }],
            [{ text: "➕ Добавить канал" }, { text: "🚫 Разбанить" }],
            [{ text: "🆔 Получить ID чата" }, { text: "📜 Список отложенных сообщений" }]
        ],
        resize_keyboard: true,
        persistent: true
    };

    try {
        if (chatId.toString() !== config.adminChannelId) {
            console.log(`⚠️ Callback не из админского чата ${config.adminChannelId}, игнорируем`);
            await bot.answerCallbackQuery(query.id, { text: safeMarkdownV2("❌ Команды доступны только в админском чате") });
            return;
        }

        if (data === "cancel") {
            console.log(`✅ Пользователь ${userId} отменил действие`);
            delete userState[userId];
            try {
                await bot.editMessageText(safeMarkdownV2("❌ Действие отменено"), {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: "MarkdownV2",
                    reply_markup: { keyboard: adminKeyboard.keyboard, resize_keyboard: true, persistent: true }
                });
            } catch (error) {
                console.warn(`⚠️ Не удалось отредактировать сообщение ${messageId}: ${error.message}`);
                await bot.sendMessage(chatId, safeMarkdownV2("❌ Действие отменено"), { parse_mode: "MarkdownV2", reply_markup: adminKeyboard });
            }
            await bot.answerCallbackQuery(query.id);
            return;
        }

        if (data.startsWith("cancel_scheduled|")) {
            const [, messageIdToCancel] = data.split("|");
            config.scheduledMessages = config.scheduledMessages.filter(msg => msg.messageId !== messageIdToCancel);
            await saveConfig(config);
            await bot.editMessageText(safeMarkdownV2(`❌ Сообщение ${messageIdToCancel} отменено`), {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: "MarkdownV2"
            });
            await bot.answerCallbackQuery(query.id, { text: safeMarkdownV2(`✅ Сообщение ${messageIdToCancel} отменено`) });
            return;
        }

        if (data.startsWith("select_channel_")) {
            const channelCode = data.split("_")[2];
            if (!config.channels[channelCode]) {
                await bot.answerCallbackQuery(query.id, { text: safeMarkdownV2(`❌ Канал ${channelCode} не найден`) });
                return;
            }
            if (!userState[userId].selectedChannels.includes(channelCode)) {
                userState[userId].selectedChannels.push(channelCode);
            } else {
                userState[userId].selectedChannels = userState[userId].selectedChannels.filter(c => c !== channelCode);
            }
            const inlineKeyboard = Object.keys(config.channels).map(code => ([{
                text: userState[userId].selectedChannels.includes(code) ? `✅ ${code}` : code,
                callback_data: `select_channel_${code}`
            }]));
            inlineKeyboard.push([{ text: "Завершить выбор каналов", callback_data: "finish_channel_selection" }]);
            inlineKeyboard.push([{ text: "Отмена", callback_data: "cancel" }]);
            await bot.editMessageText(safeMarkdownV2(`📍 Выберите каналы для публикации (выбрано: ${userState[userId].selectedChannels.join(", ") || "нет"})`), {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: "MarkdownV2",
                reply_markup: { inline_keyboard: inlineKeyboard }
            });
            await bot.answerCallbackQuery(query.id);
            return;
        }

        if (data === "finish_channel_selection") {
            if (!userState[userId].selectedChannels.length) {
                await bot.editMessageText(safeMarkdownV2("❌ Не выбрано ни одного канала"), {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: "MarkdownV2",
                    reply_markup: { inline_keyboard: [[{ text: "Отмена", callback_data: "cancel" }]] }
                });
                await bot.answerCallbackQuery(query.id);
                return;
            }
            userState[userId].state = "awaitingTimeSelection";
            await bot.editMessageText(safeMarkdownV2("📅 Введите время в формате ДД\\.ММ\\.ГГГГ ЧЧ:ММ"), {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: "MarkdownV2",
                reply_markup: { inline_keyboard: [[{ text: "Отмена", callback_data: "cancel" }]] }
            });
            await bot.answerCallbackQuery(query.id);
            return;
        }

        const [action, channelCode, targetUserId, targetMessageId] = data.split("|");
        const pendingMessage = config.pendingMessages?.find(pm => pm.userId === targetUserId && pm.messageId.toString() === targetMessageId);

        if (!pendingMessage) {
            console.log(`⚠️ Сообщение ${targetMessageId} от ${targetUserId} не найдено в pendingMessages`);
            await bot.answerCallbackQuery(query.id, { text: safeMarkdownV2("❌ Сообщение не найдено") });
            return;
        }

        if (action === "approve" || action === "approve_with_guide") {
            const channelId = config.channels[channelCode]?.channelId;
            if (!channelId) {
                console.log(`⚠️ Канал ${channelCode} не существует для сообщения ${targetMessageId} от ${targetUserId}`);
                await bot.answerCallbackQuery(query.id, { text: safeMarkdownV2(`❌ Канал ${channelCode} не найден`) });
                return;
            }
            try {
                const sentMessage = await sendMediaGroupContent(bot, channelId, pendingMessage.content);
                if (action === "approve_with_guide") {
                    await bot.sendMessage(targetUserId, safeMarkdownV2("✅ Ваше сообщение одобрено с гайдом. Следуйте рекомендациям в канале!"), { parse_mode: "MarkdownV2" });
                } else {
                    await bot.sendMessage(targetUserId, safeMarkdownV2("✅ Ваше сообщение одобрено и опубликовано"), { parse_mode: "MarkdownV2" });
                }
                await bot.editMessageText(safeMarkdownV2(`✅ Сообщение от ${username} одобрено и отправлено в канал ${channelCode}`), {
                    chat_id: chatId,
                    message_id: messageId,
                    parse_mode: "MarkdownV2"
                });
                config.pendingMessages = config.pendingMessages.filter(pm => pm.messageId.toString() !== targetMessageId.toString() || pm.userId !== targetUserId);
                await saveConfig(config);
                console.log(`✅ Сообщение ${targetMessageId} от ${targetUserId} одобрено и отправлено в ${channelCode}`);
            } catch (error) {
                console.error(`❌ Ошибка при отправке сообщения ${targetMessageId}: ${error.message}`);
                await bot.answerCallbackQuery(query.id, { text: safeMarkdownV2(`❌ Ошибка: ${error.message}`) });
            }
        } else if (action === "reject") {
            await bot.sendMessage(targetUserId, safeMarkdownV2("❌ Ваше сообщение отклонено"), { parse_mode: "MarkdownV2" });
            await bot.editMessageText(safeMarkdownV2(`❌ Сообщение от ${username} отклонено`), {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: "MarkdownV2"
            });
            config.pendingMessages = config.pendingMessages.filter(pm => pm.messageId.toString() !== targetMessageId.toString() || pm.userId !== targetUserId);
            await saveConfig(config);
            console.log(`✅ Сообщение ${targetMessageId} от ${targetUserId} отклонено`);
            await bot.answerCallbackQuery(query.id);
        } else if (action === "ban") {
            config.bannedUsers[targetUserId] = true;
            await saveConfig(config);
            await bot.sendMessage(targetUserId, safeMarkdownV2("❌ Вы забанены и не можете отправлять сообщения"), { parse_mode: "MarkdownV2" });
            await bot.editMessageText(safeMarkdownV2(`🚫 Пользователь ${username} забанен`), {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: "MarkdownV2"
            });
            config.pendingMessages = config.pendingMessages.filter(pm => pm.messageId.toString() !== targetMessageId.toString() || pm.userId !== targetUserId);
            await saveConfig(config);
            console.log(`✅ Пользователь ${targetUserId} забанен`);
            await bot.answerCallbackQuery(query.id);
        } else if (action === "to_main_admin") {
            try {
                await sendMediaGroupContent(bot, config.adminChannelId, pendingMessage.content);
                await bot.sendMessage(chatId, safeMarkdownV2(`📬 Сообщение от ${username} переслано главному админу`), {
                    parse_mode: "MarkdownV2",
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: "Одобрить", callback_data: `approve|${channelCode}|${targetUserId}|${targetMessageId}` },
                                { text: "Отклонить", callback_data: `reject|${channelCode}|${targetUserId}|${targetMessageId}` }
                            ],
                            [
                                { text: "Одобрить с гайдом", callback_data: `approve_with_guide|${channelCode}|${targetUserId}|${targetMessageId}` },
                                { text: "Бан", callback_data: `ban|${channelCode}|${targetUserId}|${targetMessageId}` }
                            ]
                        ]
                    }
                });
                config.pendingMessages = config.pendingMessages.filter(pm => pm.messageId.toString() !== targetMessageId.toString() || pm.userId !== targetUserId);
                await saveConfig(config);
                console.log(`✅ Сообщение ${targetMessageId} от ${targetUserId} переслано главному админу`);
            } catch (error) {
                console.error(`❌ Ошибка при пересылке сообщения ${targetMessageId}: ${error.message}`);
                await bot.sendMessage(chatId, safeMarkdownV2(`❌ Ошибка при пересылке: ${error.message}`), { parse_mode: "MarkdownV2", reply_markup: adminKeyboard });
            }
            await bot.answerCallbackQuery(query.id);
        } else if (action === "schedule_pending") {
            console.log(`✅ Запланировано сообщение ${targetMessageId} от ${targetUserId} для канала ${channelCode}`);
            userState[userId] = { state: "awaitingTimeSelection", content: pendingMessage.content, selectedChannels: [channelCode], isBroadcast: false };
            await bot.editMessageText(safeMarkdownV2("📅 Введите время в формате ДД\\.ММ\\.ГГГГ ЧЧ:ММ"), {
                chat_id: chatId,
                message_id: messageId,
                parse_mode: "MarkdownV2",
                reply_markup: { inline_keyboard: [[{ text: "Отмена", callback_data: "cancel" }]] }
            });
            await bot.answerCallbackQuery(query.id);
            return;
        } else {
            console.log(`⚠️ Неизвестное действие: ${action}`);
            await bot.answerCallbackQuery(query.id, { text: safeMarkdownV2("❌ Неизвестное действие") });
            return;
        }

        await bot.answerCallbackQuery(query.id, { text: safeMarkdownV2(`✅ Действие "${action}" выполнено`) });
    } catch (error) {
        console.error(`❌ Ошибка обработки callback_query: ${error.message}`, error.stack);
        await bot.answerCallbackQuery(query.id, { text: safeMarkdownV2(`❌ Ошибка: ${error.message}`) });
    }
};