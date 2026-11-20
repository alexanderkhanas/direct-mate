import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { publicApi } from '../../lib/publicApi';
import { useT } from '../../i18n';
import { Check, Copy } from '../../components/icons';
import { Skeleton, Tick, buttonClass } from '../../components/setup/ui';
import { ClaudeShell } from './ClaudeShell';

export interface ConnectorInfo {
  enabled: boolean;
  url: string | null;
}

/** The address owners paste into Claude, from the API (`MCP_PUBLIC_URL`), so the admin build needs no setting. */
export function useConnector() {
  return useQuery<ConnectorInfo>({
    queryKey: ['claude-connector'],
    queryFn: () => publicApi.get<ConnectorInfo>('/claude/connector').then((r) => r.data),
    staleTime: Infinity,
  });
}

function CopyButton({ text }: { text: string }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    });
  };
  const label = copied ? t('setup_claude.setup_copied') : t('setup_claude.setup_copy');
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={label}
      title={label}
      className={buttonClass('secondary', 'sm', 'flex-none')}
    >
      {copied ? <Check className="h-4 w-4" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
      {/* On a phone the icon alone, so the value keeps the width. */}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function Step({ n, title, children }: { n: number; title: ReactNode; children?: ReactNode }) {
  return (
    <li className="flex gap-3">
      <Tick state="todo" n={n} className="mt-px" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="text-[15px] text-pretty">{title}</p>
        {children}
      </div>
    </li>
  );
}

/** A value the owner copies: the connector address (one line, cut) or the first message (wrapped, read in full). */
function Copyable({ text, wrap }: { text: string; wrap?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span
        className={`min-w-0 flex-1 rounded-[10px] border border-dm-line bg-dm-bg px-3 py-2 text-sm ${wrap ? 'text-pretty' : 'truncate'}`}
        title={text}
      >
        {text}
      </span>
      <CopyButton text={text} />
    </div>
  );
}

/**
 * «Налаштуйте AI-агента разом із Claude» (/claude, public): how to add the
 * DirectMate connector to Claude. Linked from the Connections card; the page
 * marketing can point to.
 */
export function SetupWithClaudePage() {
  const { t } = useT();
  const connector = useConnector();

  if (connector.isLoading) {
    return (
      <ClaudeShell wide title={t('setup_claude.setup_title')}>
        <Skeleton className="h-40" />
      </ClaudeShell>
    );
  }

  const url = connector.data?.enabled ? connector.data.url : null;
  if (!url) {
    return (
      <ClaudeShell wide title={t('setup_claude.setup_off_title')} lead={t('setup_claude.setup_off_text')}>
        <Link to="/register" className={buttonClass('brand', 'lg', 'w-full')}>
          {t('setup_claude.setup_off_button')}
        </Link>
      </ClaudeShell>
    );
  }

  return (
    <ClaudeShell wide title={t('setup_claude.setup_title')} lead={t('setup_claude.setup_lead')}>
      <ol className="flex flex-col gap-3.5 lg:gap-4">
        <Step n={1} title={t('setup_claude.setup_step_copy')}>
          <Copyable text={url} />
        </Step>
        <Step n={2} title={t('setup_claude.setup_step_add')} />
        <Step n={3} title={t('setup_claude.setup_step_connect')} />
        <Step n={4} title={t('setup_claude.setup_step_chat')}>
          <Copyable text={t('setup_claude.setup_prompt')} wrap />
        </Step>
      </ol>
      <p className="text-[13px] text-dm-muted text-pretty">{t('setup_claude.setup_free_plan')}</p>
      {/* Claude Code runs on a computer: not shown on a phone. */}
      <div className="hidden flex-col gap-1.5 text-sm text-dm-muted lg:flex">
        <span>{t('setup_claude.setup_code')}</span>
        <code className="block overflow-x-auto whitespace-nowrap rounded-[10px] bg-dm-bg px-3 py-2 text-[13px] text-dm-ink">
          claude mcp add --transport http directmate {url}
        </code>
      </div>
    </ClaudeShell>
  );
}
