import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { createDemoCorsMiddleware } from './modules/demo/demo-cors.middleware';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

  // Bump body-parser limits past express's 100 KB default. The internal
  // catalog-import endpoint accepts the full Torgsoft catalog in one POST
  // (886+ products × ~50 fields × variants + categories ~ 1–5 MB today,
  // headroom for larger tenants). 50 MB caps abuse without forcing future
  // customers to chunk their syncs. All write endpoints are auth-gated
  // (JwtAuthGuard / InternalApiKeyGuard), so this isn't an open DoS surface.
  app.useBodyParser('json', { limit: '50mb' });
  app.useBodyParser('urlencoded', { limit: '50mb', extended: true });

  // Honor X-Forwarded-For from the upstream proxy (nginx / Cloudflare) so
  // req.ip and the @Ip() decorator see the real client IP. Required for the
  // /demo endpoint's per-IP rate limiter. Permissive for now; tighten to a
  // specific hop count once the deploy topology is fixed.
  app.set('trust proxy', true);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  // Mount demo CORS middleware BEFORE the global enableCors so /demo
  // OPTIONS preflights short-circuit with the demo whitelist before the
  // admin-scoped CORS layer sees them. POSTs run through both layers; the
  // demo middleware sets ACAO authoritatively and the admin layer no-ops
  // because the demo origin doesn't match the admin origin.
  const config = app.get(ConfigService);
  const demoAllowedOrigins =
    config.get<string[]>('demo.cors.allowedOrigins') ?? [];
  app.use('/demo', createDemoCorsMiddleware(demoAllowedOrigins));

  app.enableCors({
    origin: process.env.ADMIN_ORIGIN ?? 'http://localhost:5173',
    credentials: false,
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('DirectMate API')
    .setDescription('AI Instagram Assistant — MVP Backend')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  // Serve static files (privacy policy, etc.)
  app.useStaticAssets(join(__dirname, '..', 'src'), { prefix: '/static' });

  // Serve uploaded files
  app.useStaticAssets(join(process.cwd(), 'uploads'), { prefix: '/uploads' });

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`API running on http://localhost:${port}`);
  console.log(`Swagger docs: http://localhost:${port}/docs`);
}

bootstrap();
