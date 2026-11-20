import type { ReactNode } from 'react';

/**
 * The frame of the pages a link from Claude opens: one centred card, like
 * sign-up. `wide` for a page with more to read (the «how to connect» page).
 */
export function ClaudeShell({
  icon,
  title,
  lead,
  wide,
  children,
}: {
  icon?: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  wide?: boolean;
  children?: ReactNode;
}) {
  return (
    <div className="min-h-[100dvh] bg-white font-sans text-[15px] leading-[1.45] text-dm-ink antialiased lg:bg-dm-bg">
      <div
        className={`mx-auto flex min-h-[100dvh] w-full flex-col justify-center px-5 py-10 lg:px-0 ${wide ? 'lg:max-w-[680px]' : 'lg:max-w-[440px]'}`}
      >
        <div className={`flex flex-col gap-4 lg:rounded-2xl lg:border lg:border-dm-line lg:bg-white lg:shadow-dm ${wide ? 'lg:gap-5 lg:p-10' : 'lg:p-8'}`}>
          <div className="flex flex-col gap-2.5">
            {icon ?? <img src="/logo-square.png" alt="DirectMate" className="h-10 w-10 rounded-xl object-cover" />}
            <h1 className="text-[24px] font-semibold leading-[1.2] tracking-[-0.015em] text-balance">{title}</h1>
            {lead && <p className="text-[15px] text-dm-muted text-pretty">{lead}</p>}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

/** The API's error code for a failed call: `error.details.code` (AllExceptionsFilter). */
export function errorCode(err: unknown): string | undefined {
  const data = (err as { response?: { data?: { error?: { details?: { code?: string } } } } })?.response?.data;
  return data?.error?.details?.code;
}
