import * as Joi from 'joi';

export const validationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3000),
  DATABASE_URL: Joi.string().required(),
  JWT_SECRET: Joi.string().required(),
  JWT_EXPIRES_IN: Joi.string().default('7d'),
  META_APP_SECRET: Joi.string().allow('').default(''),
  META_WEBHOOK_VERIFY_TOKEN: Joi.string().allow('').default(''),
  OPENAI_API_KEY: Joi.string().allow('').default(''),
  OPENAI_MODEL: Joi.string().default('gpt-4o'),
  INTERNAL_API_KEY: Joi.string().required(),
  DEMO_DEBOUNCE_MS: Joi.number().default(1500),
  DEMO_MAX_MESSAGE_LENGTH: Joi.number().default(500),
  DEMO_RATE_LIMIT_SESSIONS_PER_HOUR: Joi.number().default(5),
  DEMO_BUDGET_CENTS_GPT54_MINI: Joi.number().default(1500),
  DEMO_BUDGET_CENTS_GPT54: Joi.number().default(500),
  DEMO_CORS_ALLOWED_ORIGINS: Joi.string().default(
    'https://directmate.ua,https://www.directmate.ua',
  ),
});
