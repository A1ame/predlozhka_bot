import { saveConfig } from './configManager.js';
import { broadcastToUsers } from './userBroadcast.js';
import { scheduleMessage } from './messageScheduler.js';
import { DateTime } from 'luxon';
import { handleMediaGroup, sendMediaGroupContent } from './mediaGroupHandler.js';
import { safeMarkdownV2 } from './utils.js';

export const checkBotAdminStatus = async (bot, config) => {
    try {
        const chatMember = await bot.getChatMember(config.adminChannelId, (await bot.getMe()).id);
        if (['administrator', 'creator'].includes(chatMember.status)) {
            console.log(`✅ Бот является администратором в канале ${config.adminChannelId}`);
        } else {
            console.error(`❌ Бот не является администратором в канале ${config.adminChannelId}`);
            process.exit(1);
        }
    } catch (error) {
        console.error(`❌ Ошибка проверки статуса администратора: ${error.message}`);
        process.exit(1);
    }
};

export const handleAdminMessage = async (bot, msg, userState, mediaGroups, config) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();
    const text = msg.text?.trim();

    console.log(`📩 Обработка сообщения в админском чате:`, {
        chatId,
        userId,
        text: text || "без текста",
        textRaw: msg.text || "без текста",
        replyToMessageId: msg.reply_to_message?.message_id || "нет",
        userState: userState[userId] || "нет состояния",
        hasPhoto: !!msg.photo,
        hasVideo: !!msg.video,
        hasDocument: !!msg.document,
        mediaGroupId: msg.media_group_id || "нет"
    });

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
            console.log(`⚠️ Сообщение не из админского чата ${config.adminChannelId}, игнорируем`);
            return;
        }

        if (text === "📅 Создать отложенное сообщение") {
            console.log(`✅ Пользователь ${userId} запрашивает создание отложенного сообщения`);
            userState[userId] = { state: "awaitingMessage", isScheduled: true, selectedChannels: [], isBroadcast: false };
            await bot.sendMessage(chatId, safeMarkdownV2("📝 Отправьте сообщение для отложенной публикации в каналы"), {
                parse_mode: "MarkdownV2",
                reply_markup: { inline_keyboard: [[{ text: "Отмена", callback_data: "cancel" }]] }
            });
            return;
        }

        if (text === "👥 Список пользователей") {
            console.log(`✅ Пользователь ${userId} запрашивает список пользователей`);
            let usersList = "📋 Список пользователей:\n\n";
            for (const uid in config.users) {
                const userInfo = await bot.getChat(uid);
                const username = userInfo.username ? `@${safeMarkdownV2(userInfo.username)}` : "без username";
                usersList += safeMarkdownV2(`ID: ${uid} | Username: ${username} | Канал: ${config.users[uid].channelCode}\n`);
            }
            if (!Object.keys(config.users).length) {
                usersList = safeMarkdownV2("❌ Пользователи отсутствуют");
            }
            await bot.sendMessage(chatId, usersList, { parse_mode: "MarkdownV2", reply_markup: adminKeyboard });
            return;
        }

        if (text === "📋 Список каналов") {
            console.log(`✅ Пользователь ${userId} запрашивает список каналов`);
            let channelsList = "📋 Список каналов:\n\n";
            for (const channelCode in config.channels) {
                const channel = config.channels[channelCode];
                channelsList += safeMarkdownV2(
                    `Код: ${channelCode}\n` +
                    `Название: ${channel.name}\n` +
                    `ID: ${channel.channelId}\n` +
                    `Ссылка для предложки: t.me/predlozhka_web_bot?start=${channelCode}\n\n`
                );
            }
            if (!Object.keys(config.channels).length) {
                channelsList = safeMarkdownV2("❌ Каналы отсутствуют");
            }
            await bot.sendMessage(chatId, channelsList, { parse_mode: "MarkdownV2", reply_markup: adminKeyboard });
            return;
        }

        if (text === "📜 Список отложенных сообщений") {
            console.log(`✅ Пользователь ${userId} запрашивает список отложенных сообщений`);
            config.scheduledMessages = config.scheduledMessages || [];
            if (!config.scheduledMessages.length) {
                await bot.sendMessage(chatId, safeMarkdownV2("❌ Нет запланированных сообщений"), { parse_mode: "MarkdownV2", reply_markup: adminKeyboard });
                return;
            }

            for (const msg of config.scheduledMessages) {
                const time = DateTime.fromISO(msg.scheduleTime).setZone("Asia/Yekaterinburg").toLocaleString(DateTime.DATETIME_FULL);
                const channels = msg.channels.join(", ") || "нет каналов";
                const contentPreview = msg.content.text
                    ? safeMarkdownV2(msg.content.text.substring(0, 50) + (msg.content.text.length > 50 ? "..." : ""))
                    : msg.content.mediaGroup
                        ? safeMarkdownV2(`медиа-группа (${msg.content.mediaGroup.length} элементов)`)
                        : msg.content.media
                            ? safeMarkdownV2(`медиа (${msg.content.media.photo ? "фото" : msg.content.media.video ? "видео" : "документ"})`)
                            : "без контента";
                const messageText = safeMarkdownV2(
                    `ID: ${msg.messageId}\n` +
                    `Время: ${time}\n` +
                    `Каналы: ${channels}\n` +
                    `Контент: ${contentPreview}\n` +
                    `Закрепить: ${msg.pin ? "да" : "нет"}\n` +
                    `Рассылка: ${msg.isBroadcast ? "да" : "нет"}`
                );
                await bot.sendMessage(chatId, messageText, {
                    parse_mode: "MarkdownV2",
                    reply_markup: {
                        inline_keyboard: [[{ text: "Отмена сообщения", callback_data: `cancel_scheduled|${msg.messageId}` }]]
                    }
                });
            }
            await bot.sendMessage(chatId, safeMarkdownV2("📜 Все отложенные сообщения показаны выше"), { parse_mode: "MarkdownV2", reply_markup: adminKeyboard });
            return;
        }

        // Обработка состояний для отложенного сообщения
        if (userState[userId]?.state === "awaitingMessage" && userState[userId].isScheduled && !userState[userId].isBroadcast) {
            await handleMediaGroup(bot, msg, mediaGroups, userId, async (content) => {
                userState[userId].content = typeof content === 'object' && content.mediaGroup ? content : {
                    text: msg.text,
                    media: msg.photo ? { photo: msg.photo, caption: msg.caption || "" } :
                        msg.video ? { video: msg.video, caption: msg.caption || "" } :
                            msg.document ? { document: msg.document, caption: msg.caption || "" } : null
                };
                userState[userId].state = "awaitingChannelSelection";
                const inlineKeyboard = Object.keys(config.channels).map(code => ([{ text: code, callback_data: `select_channel_${code}` }]));
                inlineKeyboard.push([{ text: "Завершить выбор каналов", callback_data: "finish_channel_selection" }]);
                inlineKeyboard.push([{ text: "Отмена", callback_data: "cancel" }]);
                await bot.sendMessage(chatId, safeMarkdownV2("📍 Выберите каналы для публикации"), {
                    parse_mode: "MarkdownV2",
                    reply_markup: { inline_keyboard: inlineKeyboard }
                });
            });
            return;
        }

        if (userState[userId]?.state === "awaitingTimeSelection" && userState[userId].isScheduled && !userState[userId].isBroadcast) {
            const timeMatch = text.match(/^(\d{2})\.(\d{2})\.(\d{4})\s(\d{2}):(\d{2})$/);
            if (!timeMatch) {
                await bot.sendMessage(chatId, safeMarkdownV2("❌ Неверный формат времени. Используйте ДД.ММ.ГГГГ ЧЧ:ММ"), {
                    parse_mode: "MarkdownV2",
                    reply_markup: { inline_keyboard: [[{ text: "Отмена", callback_data: "cancel" }]] }
                });
                return;
            }
            const [, day, month, year, hour, minute] = timeMatch;
            const scheduleTime = DateTime.fromObject({ day, month, year, hour, minute }, { zone: "Asia/Yekaterinburg" }).toJSDate();
            const now = DateTime.now().setZone("Asia/Yekaterinburg").toJSDate();
            if (scheduleTime <= now) {
                console.log(`⚠️ Время ${text} уже прошло для ${userId}`);
                await bot.sendMessage(chatId, safeMarkdownV2(`❌ Время ${text} уже прошло`), {
                    parse_mode: "MarkdownV2",
                    reply_markup: { inline_keyboard: [[{ text: "Отмена", callback_data: "cancel" }]] }
                });
                return;
            }
            await scheduleMessage({
                messageId: `scheduled_${userId}_${Date.now()}`,
                content: userState[userId].content,
                time: scheduleTime,
                channels: userState[userId].selectedChannels,
                pin: false,
                isBroadcast: false
            }, bot, config);
            await bot.sendMessage(chatId, safeMarkdownV2(`✅ Сообщение запланировано на ${text}`), { parse_mode: "MarkdownV2", reply_markup: adminKeyboard });
            delete userState[userId];
            return;
        }

        console.log(`⚠️ Неизвестная команда или состояние для ${userId}: ${text}`);
        await bot.sendMessage(chatId, safeMarkdownV2(`❌ Неизвестная команда: ${text}`), { parse_mode: "MarkdownV2", reply_markup: adminKeyboard });
    } catch (error) {
        console.error(`❌ Ошибка обработки команды админа ${userId}: ${error.message}`, error.stack);
        await bot.sendMessage(chatId, safeMarkdownV2(`❌ Ошибка: ${error.message}`), { parse_mode: "MarkdownV2", reply_markup: adminKeyboard });
    }
};