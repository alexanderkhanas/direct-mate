# DirectMate Backend Agent

Read the root CLAUDE.md first for full project context.

## Your scope
You work ONLY in `apps/api/`. Do not modify `apps/admin/` or `packages/shared/` unless explicitly told.

## When you need to change shared types
If you need to modify `packages/shared/src/enums.ts` or any shared interface:
1. Make the change
2. Run `cd packages/shared && npm run build`
3. Document what you changed so the frontend agent knows

## Key rules
- Never use TypeORM `synchronize: true`
- Always create a migration for schema changes (raw SQL, timestamped filename)
- Always run migrations after creating them
- Use `@CurrentUser()` decorator for tenant context in controllers
- Internal endpoints use `InternalApiKeyGuard` with `x-internal-key` header
- Encrypt sensitive tokens via CryptoService before storing

## Before starting any task
1. Read the relevant service file fully before making changes
2. Check if a migration already covers what you need
3. For conversation behaviour, read a real turn first: the admin Trace tab, or a simulator output JSON

## Testing your changes
```bash
# Unit tests (free; also run by the pre-commit hook)
cd apps/api && npm test

# Simulator — costs model calls, so suggest it and run only when asked.
# Scenarios clean up their own conversations; don't wipe tables first.
cd apps/api && npm run simulate -- --scenario <key>
```

## Common pitfalls
- SnakeNamingStrategy: entity props are camelCase, DB columns are snake_case
- packages/shared must be compiled before API can use new enums
- `ai` and `@ai-sdk/*` are ESM-only: a new jest suite that imports them needs the existing `transformIgnorePatterns`
- Agent tools take refs from the model: resolve them through `CatalogReader.resolveProductRef` with the tenant id, never trust an id as given
- `UPDATE … RETURNING` through `dataSource.query` returns `[rows, count]`: use `returnedRows()` (`common/db.ts`)
