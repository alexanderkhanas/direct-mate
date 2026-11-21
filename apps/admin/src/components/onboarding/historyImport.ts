import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';

// The Instagram history import. Mirrors apps/api/src/modules/onboarding/history/history-import.types.ts.

export type HistoryImportStatus = 'idle' | 'queued' | 'running' | 'done' | 'limited' | 'failed' | 'empty';
export type HistoryFactSection = 'delivery' | 'payment' | 'returns' | 'contacts' | 'hours';

export interface HistoryFact {
  section: HistoryFactSection;
  text: string;
  /** How many conversations said it. */
  count: number;
}

export interface HistoryExample {
  customer: string;
  manager: string;
}

export interface HistoryImport {
  consent: boolean;
  status: HistoryImportStatus;
  retryAfter?: string | null;
  toppedUp?: boolean;
  stats?: { conversations: number; messages: number; humanReplies: number };
  tone?: string | null;
  traits?: string[];
  examples?: HistoryExample[];
  facts?: HistoryFact[];
  applied?: boolean;
  error?: string | null;
}

/** GET /onboarding/history */
export interface HistoryImportView {
  instagramConnected: boolean;
  import: HistoryImport | null;
}

/** Shared by the Instagram, notes and tone steps and the Dashboard. */
export const HISTORY_KEY = ['history-import'];

const POLL_MS = 3000;
/** While a passing error is being retried (minutes apart), check back less often. */
const RETRY_POLL_MS = 30_000;

/** The agent reads this many example replies; the owner's own come first (history-import.service.ts). */
export const AGENT_EXAMPLES = 8;
/** Tag of the examples the import applied (HISTORY_EXAMPLE_TAG). */
export const HISTORY_EXAMPLE_TAG = 'instagram-history';

const later = (iso: string | null | undefined) => !!iso && Date.parse(iso) > Date.now();

/**
 * Where the import is, as the owner sees it. `waiting` is the one top-up an
 * hour after a first pass that found too few replies; an import retrying
 * after a passing error still reads as `reading`.
 */
export type HistoryPhase = 'none' | 'reading' | 'waiting' | 'limited' | 'done' | 'empty' | 'failed';

export function historyPhase(imp: HistoryImport | null | undefined): HistoryPhase {
  switch (imp?.status) {
    case 'queued':
      return later(imp.retryAfter) && !imp.error ? 'waiting' : 'reading';
    case 'running':
      return 'reading';
    case 'limited':
    case 'done':
    case 'empty':
    case 'failed':
      return imp.status;
    default:
      return 'none';
  }
}

/** The key sections the facts cover, in the notes' order. */
export function factSections(imp: HistoryImport | null | undefined): HistoryFactSection[] {
  const found = new Set((imp?.facts ?? []).map((f) => f.section));
  return (['delivery', 'payment', 'returns', 'contacts', 'hours'] as const).filter((s) => found.has(s));
}

/** GET /onboarding/history; polls while the chats are being read, when `poll` is set (every 3 s, or 30 s between retries). */
export function useHistoryImport({ poll = false, enabled = true }: { poll?: boolean; enabled?: boolean } = {}) {
  return useQuery<HistoryImportView>({
    queryKey: HISTORY_KEY,
    queryFn: () => api.get('/onboarding/history').then((r) => r.data),
    enabled,
    refetchInterval: (query) => {
      const imp = query.state.data?.import;
      if (!poll || historyPhase(imp) !== 'reading') return false;
      return later(imp?.retryAfter) ? RETRY_POLL_MS : POLL_MS;
    },
  });
}

/** Record the owner's consent, then queue the import («Прочитати переписки»). */
export function useStartHistoryImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await api.post('/onboarding/history/consent', { read: true });
      return api.post<HistoryImportView>('/onboarding/history/import').then((r) => r.data);
    },
    onSuccess: (view) => {
      qc.setQueryData(HISTORY_KEY, view);
      // The consent is the read permission («read the Direct»): Settings and the launch step show it.
      void qc.invalidateQueries({ queryKey: ['direct-permissions'] });
    },
  });
}
