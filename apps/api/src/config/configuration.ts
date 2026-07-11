export default () => ({
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: parseInt(process.env.PORT ?? '3000', 10),
  app: {
    backendBaseUrl: process.env.BACKEND_BASE_URL ?? 'http://host.docker.internal:3000',
    baseUrl: process.env.APP_BASE_URL ?? 'http://localhost:3000',
    adminUrl: process.env.ADMIN_BASE_URL ?? 'http://localhost:5173',
  },
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
    // Used by ReplyEngineService.aiFallback (free-form reply when no
    // template matches). Customer-facing text — quality matters more
    // than latency/cost. Defaults to gpt-5.4.
    model: process.env.OPENAI_MODEL ?? 'gpt-5.4',
    // Used by ClassifierService — every turn, entity extraction + intent
    // routing. Fast and cheap; gpt-5.4-mini handles this well.
    classifierModel: process.env.OPENAI_CLASSIFIER_MODEL ?? 'gpt-5.4-mini',
    // Used by InstagramContentService (vision matching) and
    // ScreenshotExtractionService. Vision tasks need a stronger model.
    visionModel: process.env.OPENAI_VISION_MODEL ?? 'gpt-4o',
    // Used by ClassifierService.classifyWithFallback for handoff
    // verification (second-opinion classifier pass). gpt-4.1 was the
    // previous default — retired from ChatGPT Feb 2026, 4.1-nano API
    // shutdown Jul 23 2026; gpt-5.4 (the main model) replaces it before
    // the API shutdown wave reaches the full 4.1.
    fallbackModel: process.env.OPENAI_FALLBACK_MODEL ?? 'gpt-5.4',
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
  mono: {
    merchantToken: process.env.MONO_MERCHANT_TOKEN ?? '',
  },
  demo: {
    debounceMs: parseInt(process.env.DEMO_DEBOUNCE_MS ?? '1500', 10),
    maxMessageLength: parseInt(process.env.DEMO_MAX_MESSAGE_LENGTH ?? '500', 10),
    rateLimit: {
      sessionsPerHour: parseInt(
        process.env.DEMO_RATE_LIMIT_SESSIONS_PER_HOUR ?? '5',
        10,
      ),
    },
    budget: {
      classifierCentsPerDay: parseInt(
        process.env.DEMO_BUDGET_CENTS_GPT54_MINI ?? '1500',
        10,
      ),
      fallbackCentsPerDay: parseInt(
        process.env.DEMO_BUDGET_CENTS_GPT54 ?? '500',
        10,
      ),
    },
    cors: {
      allowedOrigins: (
        process.env.DEMO_CORS_ALLOWED_ORIGINS ??
        'https://directmate.ua,https://www.directmate.ua'
      )
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    },
  },
});
