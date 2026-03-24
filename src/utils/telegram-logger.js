import { CONFIG } from '../config.js';

let isInitialized = false;

/**
 * Gets basic device info for the error report
 */
function getDeviceInfo() {
    return navigator.userAgent || 'Unknown Device';
}

/**
 * Sends an error message to the configured Telegram bot
 * @param {Error|string} error - The error object or message string
 * @param {string} [context='Frontend'] - Where the error occurred
 */
export async function sendErrorToTelegram(error, context = 'Frontend') {
    const { botToken, chatId } = CONFIG.telegram;
    
    // Do nothing if bot is not configured
    if (!botToken || !chatId) {
        return; 
    }

    try {
        const errorMessage = error instanceof Error 
            ? `${error.name}: ${error.message}\n${error.stack}` 
            : String(error);
            
        const deviceInfo = getDeviceInfo();
        const timestamp = new Date().toISOString();
        const pageUrl = window.location.href;
        
        const text = `🚨 *SignBridge Avatar Error*\n\n` +
                     `*Context:* ${context}\n` +
                     `*Time:* ${timestamp}\n` +
                     `*Page:* ${pageUrl}\n` +
                     `*Device:* \`${deviceInfo}\`\n\n` +
                     `*Error Details:* \n\`\`\`text\n${errorMessage.substring(0, 2000)}\n\`\`\``;

        const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
        
        // Use fetch with keepalive to ensure sending even if page unloads
        await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                chat_id: chatId,
                text: text,
                parse_mode: 'Markdown'
            }),
            keepalive: true
        });
    } catch (e) {
        console.error('[Telegram Logger] Failed to send error to Telegram:', e);
    }
}

/**
 * Initializes global error listeners for window.onerror and unhandledrejection.
 * Prevents multiple registrations if called multiple times.
 */
export function initGlobalErrorLogger() {
    if (isInitialized) return;
    
    window.addEventListener('error', (event) => {
        sendErrorToTelegram(event.error || event.message, 'Global Error (window.onerror)');
    });

    window.addEventListener('unhandledrejection', (event) => {
        sendErrorToTelegram(event.reason, 'Unhandled Promise Rejection');
    });
    
    console.log('[Telegram Logger] Global error handlers registered');
    isInitialized = true;
}
