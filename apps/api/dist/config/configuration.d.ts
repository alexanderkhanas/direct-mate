declare const _default: () => {
    nodeEnv: string;
    port: number;
    app: {
        backendBaseUrl: string;
        baseUrl: string;
        adminUrl: string;
    };
    database: {
        url: string | undefined;
    };
    jwt: {
        secret: string;
        expiresIn: string;
    };
    meta: {
        appSecret: string;
        webhookVerifyToken: string;
        appId: string;
        oauthRedirectUri: string;
    };
    admin: {
        baseUrl: string;
    };
    encryption: {
        key: string;
    };
    openai: {
        apiKey: string;
        model: string;
        fallbackModel: string;
    };
    internal: {
        apiKey: string;
    };
    n8n: {
        orderSyncWebhookUrl: string;
    };
    telegram: {
        botToken: string;
        webhookSecret: string;
        botUsername: string;
    };
    mono: {
        merchantToken: string;
    };
    demo: {
        debounceMs: number;
        maxMessageLength: number;
        rateLimit: {
            sessionsPerHour: number;
        };
        budget: {
            classifierCentsPerDay: number;
            fallbackCentsPerDay: number;
        };
        cors: {
            allowedOrigins: string[];
        };
    };
};
export default _default;
