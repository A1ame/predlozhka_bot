import TelegramBot from "node-telegram-bot-api";
import { promises as fs } from "fs";
import { DateTime } from "luxon";

// --- Логгер-бот ---
// В файле logger.js
const loggerBotToken = "8552858742:AAEJhNI2zBW7eoy2mmDg7KFgdLnNSSjKmEU"; // Твой токен
const targetChatId = "5187796471"; // Твой личный ID (не чата, а именно профиля)
const loggerBot = new TelegramBot(loggerBotToken); // Без polling

// Флаг для предотвращения рекурсии в логировании
let isLogging = false;

// Отправка лога
const sendLog = async (level, message) => {
    if (isLogging) return; // Предотвращаем рекурсию
    isLogging = true;

    const timestamp = DateTime.now().setZone("Asia/Yekaterinburg").toFormat("yyyy-MM-dd HH:mm:ss");
    const formattedMessage = `[${level}] ${timestamp}\n${message}`;

    try {
        await loggerBot.sendMessage(targetChatId, formattedMessage, { parse_mode: "Markdown" });
        originalConsole.log(`Лог отправлен в ${targetChatId}: [${level}] ${message}`);
    } catch (error) {
        originalConsole.error(`❌ Ошибка отправки лога в ${targetChatId}: ${error.message}`);
    } finally {
        isLogging = false;
    }

    // Запись в файл
    try {
        await fs.appendFile("bot.log", `${formattedMessage}\n`, "utf8");
    } catch (error) {
        originalConsole.error(`❌ Ошибка записи лога в файл: ${error.message}`);
    }
};

// Перехват console методов
const originalConsole = {
    log: console.log,
    error: console.error,
    warn: console.warn,
    info: console.info,
};

console.log = (...args) => {
    const message = args.map(arg => (typeof arg === "object" ? JSON.stringify(arg, null, 2) : arg)).join(" ");
    originalConsole.log(...args);
    sendLog("INFO", message);
};

console.error = (...args) => {
    const message = args.map(arg => (typeof arg === "object" ? JSON.stringify(arg, null, 2) : arg)).join(" ");
    originalConsole.error(...args);
    sendLog("ERROR", message);
};

console.warn = (...args) => {
    const message = args.map(arg => (typeof arg === "object" ? JSON.stringify(arg, null, 2) : arg)).join(" ");
    originalConsole.warn(...args);
    sendLog("WARN", message);
};

console.info = (...args) => {
    const message = args.map(arg => (typeof arg === "object" ? JSON.stringify(arg, null, 2) : arg)).join(" ");
    originalConsole.info(...args);
    sendLog("INFO", message);
};

// Удержание процесса активным
setInterval(() => {
    // Пустой интервал для предотвращения завершения процесса
}, 1000 * 60 * 60); // Каждые 60 минут, чтобы минимизировать нагрузку

// Инициализация логгер-бота
console.log("✅ Logger бот запущен!");
console.log(`Часовой пояс: Asia/Yekaterinburg`);

export { sendLog };