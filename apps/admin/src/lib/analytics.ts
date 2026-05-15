declare global {
  interface Window {
    umami?: {
      track: (event: string, props?: Record<string, unknown>) => void;
    };
  }
}

export function initAnalytics(): void {
  // Umami loads via <script> in index.html; nothing to initialise here.
  // Kept as a no-op so main.tsx's call site stays untouched.
}

type DemoErrorType = 'too_long' | 'rate_limit' | 'budget_exceeded';
type CtaButtonLocation = 'hero' | 'demo_section' | 'bottom_cta' | 'header';
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
