// Umami loads from a <script> in layouts/Base.astro (production builds only).
declare global {
  interface Window {
    umami?: {
      track: (event: string, props?: Record<string, unknown>) => void;
    };
  }
}

type DemoErrorType = 'too_long' | 'rate_limit' | 'budget_exceeded';
/** Where the sign-up link sits: `data-cta` on the link (header, hero, bottom_cta, …). */
type CtaButtonLocation = string;
type CtaButtonType = 'primary_cta' | 'demo_scroll';

function track(event: string, props?: Record<string, unknown>): void {
  window.umami?.track(event, props);
}

/**
 * Optional `tenantSlug` (e.g. `'demo-women-clothes'`, `'demo-cosmetics'`) is
 * attached to all demo-* events as a property so dashboards can split
 * funnels by demo tenant. Omitting it keeps the event tenant-agnostic for the
 * landing-level events (e.g. demo_section_visible fires before any tab choice).
 */
export const analytics = {
  demoSectionVisible(): void {
    track('demo_section_visible');
  },
  demoViewed(source: 'landing', tenantSlug?: string): void {
    sessionStorage.setItem('demo_viewed_fired', '1');
    track('demo_viewed', { source, tenantSlug });
  },
  demoTabSwitched(tenantSlug: string): void {
    track('demo_tab_switched', { tenantSlug });
  },
  demoScenarioClicked(scenario: string, tenantSlug?: string): void {
    sessionStorage.setItem('demo_interacted', '1');
    track('demo_scenario_clicked', { scenario, tenantSlug });
  },
  demoLiveModeStarted(tenantSlug?: string): void {
    track('demo_live_mode_started', { tenantSlug });
  },
  demoMessageSent(messageIndex: number, isAggregated: boolean, tenantSlug?: string): void {
    sessionStorage.setItem('demo_interacted', '1');
    track('demo_message_sent', { messageIndex, isAggregated, tenantSlug });
  },
  demoErrorReceived(errorType: DemoErrorType, tenantSlug?: string): void {
    track('demo_error_received', { errorType, tenantSlug });
  },
  ctaClicked(buttonLocation: CtaButtonLocation, buttonType: CtaButtonType): void {
    track('cta_clicked', { buttonLocation, buttonType });
    if (sessionStorage.getItem('demo_viewed_fired') === '1') {
      track('demo_cta_clicked', {
        buttonLocation,
        interactedWithDemo: sessionStorage.getItem('demo_interacted') === '1',
      });
    }
  },
};
