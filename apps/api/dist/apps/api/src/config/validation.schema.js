"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validationSchema = void 0;
const Joi = require("joi");
exports.validationSchema = Joi.object({
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
});
//# sourceMappingURL=validation.schema.js.map