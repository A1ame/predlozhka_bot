import TelegramBot from 'node-telegram-bot-api';
import { loadConfig, saveConfig } from './configManager.js';
import { handleAdminMessage, checkBotAdminStatus } from './adminHandler.js';
import { sendMessageToMainAdmin } from './userBroadcast.js';
import { handleCallbackQuery } from './callbackHandler.js';
import { scheduleMessage } from './messageScheduler.js';
import { handleMediaGroup, sendMediaGroupContent } from './mediaGroupHandler.js';
import { safeMarkdownV2 } from './utils.js';

const config = await loadConfig();
const bot = new TelegramBot(config.botToken, { polling: true });
const userState = {};
const mediaGroups = {};

await checkBotAdminStatus(bot, config);

for (const channelCode in config.channels) {
    try {
        const chatMember = await bot.getChatMember(config.channels[channelCode].channelId, (await bot.getMe()).id);
        if (['administrator', 'creator'].includes(chatMember.status)) {
            console.log(`✅ Бот является администратором в канале ${channelCode} (${config.channels[channelCode].channelId}): ${chatMember.status}`);
        } else {
            console.error(`⚠️ Бот не является администратором в канале ${channelCode} (${config.channels[channelCode].channelId})`);
            console.log(`⚠️ Пожалуйста, назначьте бота администратором в канале ${channelCode} или удалите канал через команду 🗑 Удалить канал`);
        }
    } catch (error) {
        console.error(`❌ Ошибка проверки статуса администратора в канале ${channelCode}: ${error.message}`);
        console.log(`⚠️ Пожалуйста, проверьте ID канала ${config.channels[channelCode].channelId} для ${channelCode} или удалите канал через команду 🗑 Удалить канал`);
    }
}

const sendScheduledMessages = async () => {
    const now = new Date();
    console.log(`🔄 Проверка запланированных сообщений на ${now.toISOString()}`);
    config.scheduledMessages = config.scheduledMessages || [];
    console.log(`📋 Найдено ${config.scheduledMessages.length} запланированных сообщений`);
    let messagesToSend = config.scheduledMessages.filter(msg => new Date(msg.scheduleTime) <= now);
    let messagesToKeep = config.scheduledMessages.filter(msg => new Date(msg.scheduleTime) > now);

    console.log(`📤 Сообщений для отправки: ${messagesToSend.length}, сообщений для сохранения: ${messagesToKeep.length}`);

    for (const msg of messagesToSend) {
        try {
            if (msg.isBroadcast) {
                await broadcastToUsers(bot, msg.content, config);
            } else {
                for (const channelCode of msg.channels) {
                    const channelId = config.channels[channelCode]?.channelId;
                    if (!channelId) {
                        console.error(`❌ Канал ${channelCode} не найден для сообщения ${msg.messageId}`);
                        continue;
                    }
                    const sentMessage = await sendMediaGroupContent(bot, channelId, msg.content);
                    if (msg.pin) {
                        await bot.pinChatMessage(channelId, sentMessage.message_id);
                    }
                }
                console.log(`✅ Сообщение ${msg.messageId} отправлено в каналы: ${msg.channels.join(", ")}`);
            }
            messagesToKeep = messagesToKeep.filter(m => m.messageId !== msg.messageId);
            config.scheduledMessages = messagesToKeep;
            await saveConfig(config);
        } catch (error) {
            console.error(`❌ Ошибка отправки сообщения ${msg.messageId}: ${error.message}`);
            await bot.sendMessage(config.adminChannelId, `❌ Ошибка отправки сообщения ${safeMarkdownV2(msg.messageId)}: ${safeMarkdownV2(error.message)}`, {
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
            messagesToKeep = messagesToKeep.filter(m => m.messageId !== msg.messageId);
            config.scheduledMessages = messagesToKeep;
            await saveConfig(config);
        }
    }
};

setInterval(sendScheduledMessages, 60000);

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id.toString();

    if (chatId.toString() === config.adminChannelId) {
        await handleAdminMessage(bot, msg, userState, mediaGroups, config);
        return;
    }

    if (msg.text?.startsWith('/start')) {
        if (config.bannedUsers[userId]) {
            console.log(`⚠️ Пользователь ${userId} забанен`);
            return; // Не отправляем уведомление о бане
        }

        const [, channelCode] = msg.text.split(' ');
        if (!channelCode) {
            await bot.sendMessage(chatId, safeMarkdownV2("❌ Укажите код канала, например: /start test"), { parse_mode: "MarkdownV2" });
            return;
        }
        if (!config.channels[channelCode]) {
            await bot.sendMessage(chatId, safeMarkdownV2(`❌ Канал ${channelCode} не найден`), { parse_mode: "MarkdownV2" });
            return;
        }
        config.users[userId] = { isAdmin: false, channelCode };
        await saveConfig(config);
        console.log(`✅ Пользователь ${userId} привязан к каналу ${channelCode}`);
        // Экранируем весь текст сообщения
        await bot.sendMessage(chatId, safeMarkdownV2(`✅ Вы привязаны к каналу ${channelCode}. Отправляйте сообщения для проверки`), { parse_mode: "MarkdownV2" });
        return;
    }

    if (config.bannedUsers[userId]) {
        console.log(`⚠️ Пользователь ${userId} забанен`);
        return; // Не отправляем уведомление о бане
    }

    const channelCode = config.users[userId]?.channelCode;
    if (!channelCode || !config.channels[channelCode]) {
        console.log(`⚠️ Пользователь ${userId} не привязан к каналу или канал не существует`);
        await bot.sendMessage(chatId, safeMarkdownV2("❌ Вы не привязаны к каналу. Используйте /start <код_канала>"), { parse_mode: "MarkdownV2" });
        return;
    }

    await handleMediaGroup(bot, msg, mediaGroups, userId, async (content) => {
        const messageId = msg.message_id;
        if (!config.channels[channelCode]) {
            console.log(`⚠️ Канал ${channelCode} не существует для сообщения ${messageId} от ${userId}`);
            await bot.sendMessage(chatId, safeMarkdownV2(`❌ Канал ${channelCode} не найден`), { parse_mode: "MarkdownV2" });
            return;
        }
        await sendMessageToMainAdmin(bot, config.adminChannelId, {
            userId,
            messageId,
            content: typeof content === 'object' && content.mediaGroup ? content : {
                text: msg.text,
                media: msg.photo ? { photo: msg.photo, caption: msg.caption || "" } :
                    msg.video ? { video: msg.video, caption: msg.caption || "" } :
                        msg.document ? { document: msg.document, caption: msg.caption || "" } : null
            },
            channelCode
        }, config);
    });
});

bot.on('callback_query', async query => {
    await handleCallbackQuery(bot, query, userState, config.scheduledMessages, mediaGroups, config);
});

console.log('Бот запущен...');