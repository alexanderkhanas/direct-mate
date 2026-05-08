"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const core_1 = require("@nestjs/core");
const config_1 = require("@nestjs/config");
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const path_1 = require("path");
const app_module_1 = require("./app.module");
const http_exception_filter_1 = require("./common/filters/http-exception.filter");
const demo_cors_middleware_1 = require("./modules/demo/demo-cors.middleware");
async function bootstrap() {
    const app = await core_1.NestFactory.create(app_module_1.AppModule, { rawBody: true });
    app.useBodyParser('json', { limit: '50mb' });
    app.useBodyParser('urlencoded', { limit: '50mb', extended: true });
    app.set('trust proxy', true);
    app.useGlobalPipes(new common_1.ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: false,
        transform: true,
    }));
    app.useGlobalFilters(new http_exception_filter_1.AllExceptionsFilter());
    const config = app.get(config_1.ConfigService);
    const demoAllowedOrigins = config.get('demo.cors.allowedOrigins') ?? [];
    app.use('/demo', (0, demo_cors_middleware_1.createDemoCorsMiddleware)(demoAllowedOrigins));
    app.enableCors({
        origin: process.env.ADMIN_ORIGIN ?? 'http://localhost:5173',
        credentials: false,
    });
    const swaggerConfig = new swagger_1.DocumentBuilder()
        .setTitle('DirectMate API')
        .setDescription('AI Instagram Assistant — MVP Backend')
        .setVersion('1.0')
        .addBearerAuth()
        .build();
    const document = swagger_1.SwaggerModule.createDocument(app, swaggerConfig);
    swagger_1.SwaggerModule.setup('docs', app, document);
    app.useStaticAssets((0, path_1.join)(__dirname, '..', 'src'), { prefix: '/static' });
    app.useStaticAssets((0, path_1.join)(process.cwd(), 'uploads'), { prefix: '/uploads' });
    const port = process.env.PORT ?? 3000;
    await app.listen(port);
    console.log(`API running on http://localhost:${port}`);
    console.log(`Swagger docs: http://localhost:${port}/docs`);
}
bootstrap();
//# sourceMappingURL=main.js.map