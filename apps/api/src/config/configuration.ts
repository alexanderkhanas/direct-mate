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
    // The "Instagram API (Unified Login)" configuration in the App Dashboard.
    loginConfigId: process.env.META_LOGIN_CONFIG_ID ?? '',
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
    // Used by InstagramContentService (vision matching) and
    // ScreenshotExtractionService. Vision tasks need a stronger model.
    visionModel: process.env.OPENAI_VISION_MODEL ?? 'gpt-4o',
  },
  // Product attributes read from photos (catalog/attributes). The background
  // worker is off unless enabled: it spends model calls on every new or
  // changed product. `npm run attributes:extract` runs it for one store.
  attributes: {
    model: process.env.ATTRIBUTES_MODEL ?? 'gpt-6.1-terra',
    reasoningEffort: process.env.ATTRIBUTES_REASONING_EFFORT || 'low',
    workerEnabled: process.env.ATTRIBUTES_WORKER_ENABLED === 'true',
    tickMs: parseInt(process.env.ATTRIBUTES_WORKER_TICK_MS ?? '60000', 10),
    batch: parseInt(process.env.ATTRIBUTES_WORKER_BATCH ?? '10', 10),
    backoffMinutes: parseInt(process.env.ATTRIBUTES_WORKER_BACKOFF_MIN ?? '30', 10),
  },
  // Reads an uploaded size chart image into a table (size-charts/size-chart-reader).
  // Needs vision; one call per chart the owner uploads.
  sizeCharts: {
    model: process.env.SIZE_CHART_MODEL || process.env.ATTRIBUTES_MODEL || 'gpt-6.1-terra',
    reasoningEffort: process.env.SIZE_CHART_REASONING_EFFORT || 'low',
  },
  // Reads a store's recent Instagram DMs once at setup (onboarding/history).
  // On for the API; the CLI scripts that boot AppModule turn it off, so a
  // simulator run never spends the app's Meta budget or claims a store.
  historyImport: {
    workerEnabled: process.env.HISTORY_IMPORT_WORKER_ENABLED !== 'false',
  },
  agent: {
    // v2 tool-calling agent (docs/v2-agent). The model id picks the provider;
    // a store can override it with tenant_settings.ai_settings.model.
    model: process.env.AGENT_MODEL ?? 'gpt-5.4-mini',
    // Model calls per attempt. A turn is usually 2-4; hitting the cap hands off.
    maxSteps: parseInt(process.env.AGENT_MAX_STEPS ?? '6', 10),
    timeoutMs: parseInt(process.env.AGENT_TIMEOUT_MS ?? '45000', 10),
    // Optional OpenAI reasoning effort. GPT-6: none | low | medium | high |
    // xhigh | max; GPT-5.4: none | low | medium | high. Unset = the
    // provider's default; tune from traces.
    reasoningEffort: process.env.AGENT_REASONING_EFFORT || undefined,
    // Optional sampling temperature. OpenAI accepts it only with reasoning
    // effort `none`; otherwise it is dropped (see AgentModelFactory).
    temperature: process.env.AGENT_TEMPERATURE ? parseFloat(process.env.AGENT_TEMPERATURE) : undefined,
    // Stronger model that scores Ukrainian quality in the simulator (Phase 6).
    judgeModel: process.env.JUDGE_MODEL ?? 'gpt-5.4',
    // Live channels: a customer past this many messages an hour is handed to a
    // manager instead of answered. No person types that fast; a script does.
    maxCustomerMessagesPerHour: parseInt(process.env.AGENT_MAX_CUSTOMER_MESSAGES_PER_HOUR ?? '60', 10),
    // OpenAI's moderation check on every reply before it is sent (free).
    moderation: process.env.AGENT_MODERATION !== 'false',
    // What the prompt carries of the catalog: 'list' = one line per product
    // (cost grows with the catalog); 'overview' = categories with counts and
    // price ranges, and the model finds products with its tools.
    catalogPrompt: process.env.AGENT_CATALOG_PROMPT === 'overview' ? 'overview' : 'list',
  },
  instagram: {
    // Wait this long after a customer's last message before answering, so
    // «photo + "є таке?"» or a burst of short messages get one reply.
    debounceMs: parseInt(process.env.INSTAGRAM_DEBOUNCE_MS ?? '5000', 10),
    // Decides whether a comment under a post is a question for the shop.
    commentGateModel: process.env.INSTAGRAM_COMMENT_GATE_MODEL ?? 'gpt-5.4-mini',
  },
  anthropic: {
    // For `claude-*` agent models once the Anthropic provider is installed
    // (Phase 6 model comparison).
    apiKey: process.env.ANTHROPIC_API_KEY ?? '',
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
    // The founder's chat with the bot: sign-ups, help requests, stores going
    // live. Unset = no platform notifications.
    platformChatId: process.env.PLATFORM_TELEGRAM_CHAT_ID ?? '',
  },
  support: {
    // «Налаштуйте за мене» opens t.me/<this>?text=… with the message filled in.
    telegramUsername: process.env.SUPPORT_TELEGRAM_USERNAME ?? '',
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
