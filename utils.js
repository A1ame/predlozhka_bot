export const safeMarkdownV2 = (text) => {
    if (!text) return '';
    return text.toString().replace(/([._*[\]()~`>#+=|{}!\\-])/g, '\\$1');
};