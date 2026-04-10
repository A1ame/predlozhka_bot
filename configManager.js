import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const configPath = path.join(__dirname, 'config.json');

export const loadConfig = async () => {
    try {
        const data = await fs.readFile(configPath, 'utf8');
        const config = JSON.parse(data);
        console.log('Загружен config:', {
            adminChannelId: config.adminChannelId,
            channels: Object.keys(config.channels || {}),
            users: Object.keys(config.users || {}),
            bannedUsers: Object.keys(config.bannedUsers || {}),
            pendingMessages: (config.pendingMessages || []).length,
            scheduledMessages: (config.scheduledMessages || []).length
        });
        return config;
    } catch (error) {
        console.error(`❌ Ошибка загрузки config.json: ${error.message}`);
        throw error;
    }
};

export const saveConfig = async (config) => {
    try {
        await fs.writeFile(configPath, JSON.stringify(config, null, 2));
        console.log('✅ Конфигурация сохранена');
    } catch (error) {
        console.error(`❌ Ошибка сохранения config.json: ${error.message}`);
        throw error;
    }
};