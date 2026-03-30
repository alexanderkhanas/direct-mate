"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = () => ({
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: parseInt(process.env.PORT ?? '3000', 10),
    database: {
        url: process.env.DATABASE_URL,
    },
    jwt: {
        secret: process.env.JWT_SECRET ?? 'insecure-default',
        expiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
    },
    meta: {
        appSecret: process.env.META_APP_SECRET ?? '',
        webhookVerifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN ?? '',
        appId: process.env.META_APP_ID ?? '',
        oauthRedirectUri: process.env.INSTAGRAM_OAUTH_REDIRECT_URI ?? '',
    },
    admin: {
        baseUrl: process.env.ADMIN_BASE_URL ?? 'http://localhost:5173',
    },
    encryption: {
        key: process.env.ENCRYPTION_KEY ?? '',
    },
    openai: {
        apiKey: process.env.OPENAI_API_KEY ?? '',
        model: process.env.OPENAI_MODEL ?? 'gpt-4o',
        fallbackModel: process.env.OPENAI_FALLBACK_MODEL ?? 'gpt-4.1',
    },
    internal: {
        apiKey: process.env.INTERNAL_API_KEY ?? '',
    },
    n8n: {
        orderSyncWebhookUrl: process.env.N8N_ORDER_SYNC_WEBHOOK_URL ?? '',
    },
    telegram: {
        botToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
        webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET ?? '',
        botUsername: process.env.TELEGRAM_BOT_USERNAME ?? 'DirectMateBot',
    },
});
//# sourceMappingURL=configuration.js.map