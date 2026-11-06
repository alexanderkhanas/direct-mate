# DirectMate

An AI sales assistant for Instagram DMs. Each store connects its Instagram account and catalog,
and the assistant answers routine customer questions, helps with sizes and collects orders. It
hands the conversation to a human manager when it should.

The reply engine is being rebuilt as a tool-calling agent. See `docs/v2-agent/`.

## Repository

```
apps/api/         NestJS backend (TypeORM, PostgreSQL)
apps/admin/       React + Vite admin panel, landing page and demo widget
packages/shared/  Shared enums, compiled to JS
infra/            Docker Compose for local dev and production
scripts/          Operational CLIs
docs/             Architecture docs, v2 agent decisions and plan, archive
```

## Local development

```bash
cd infra/docker && docker compose up -d          # Postgres on port 5433
cd packages/shared && npm run build
cd apps/api && npm run dev                       # API
cd apps/admin && npm run dev                     # admin panel
```

Migrations, seeds, the conversation simulator and other commands are listed in `CLAUDE.md`.

## Documentation

- `docs/v2-agent/decisions.md`: agent architecture decisions
- `docs/v2-agent/implementation-plan.md`: phased implementation plan
- `docs/architecture/`: how the current code works
- `docs/deploy.md`: deployment
