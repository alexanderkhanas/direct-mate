# DirectMate Frontend Agent

Read the root CLAUDE.md first for full project context.

## Your scope
You work ONLY in `apps/admin/`. Do not modify `apps/api/`.

## Key rules
- Use TanStack Query for ALL data fetching — no raw fetch() in components
- Use existing components from `components/ui/` before creating new ones
- Tailwind only — no inline styles, no CSS files
- Icons from `lucide-react` only
- Never call internal API endpoints (those are for n8n only)

## API conventions
- All endpoints require JWT (stored in localStorage as `token`)
- Base URL from `import { api } from '../lib/api'`
- Mutations use `useMutation` with `queryClient.invalidateQueries` on success
- Always show error state for failed mutations — never swallow errors silently

## Adding a new page
1. Create page in `src/pages/`
2. Add route in `App.tsx` inside `<PrivateRoute>`
3. Add nav item in `Layout.tsx` if needed
4. Check if user role affects visibility (`user.role === 'superadmin'`)

## Adding a new scenario to TemplatesPage
1. Add to `SCENARIO_LABELS` object
2. Add to `SCENARIO_COLORS` object
3. Both are at the top of `TemplatesPage.tsx`

## Before starting any task
1. Check if a similar component already exists in `components/ui/`
2. Check how existing pages handle the same pattern (loading, error, empty states)
3. Run `cd apps/admin && npm run dev` to verify no existing TypeScript errors

## Known pre-existing issues
- ConnectionsPage has TypeScript errors — do not fix unless the task requires it
- Do not add new `as any` casts