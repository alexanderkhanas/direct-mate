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
3. Run `tail -f apps/api/conversations.log | jq .` to understand current behavior

## Testing your changes
```bash
# Reset conversations for clean test
docker exec docker-postgres-1 psql -U postgres -d directmate -c "DELETE FROM audit_logs; DELETE FROM messages; DELETE FROM conversation_state; DELETE FROM conversations; DELETE FROM customers;"

# Run simulator
cd apps/api && npm run simulate -- --scenario 

# Replay last conversation
cd apps/api && npm run replay
```

## Common pitfalls
- SnakeNamingStrategy: entity props are camelCase, DB columns are snake_case
- packages/shared must be compiled before API can use new enums
- AssistantMemory changes need to be backward compatible (old conversations have old memory shape)
- reply-engine.service.ts is ~1700 lines — read it fully before touching it