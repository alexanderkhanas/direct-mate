import posthog from 'posthog-js';

let initialized = false;

export function initAnalytics(): void {
  const key = import.meta.env.VITE_POSTHOG_KEY;
  if (!key) return;
  posthog.init(key, {
    api_host: import.meta.env.VITE_POSTHOG_HOST ?? 'https://eu.i.posthog.com',
    person_profiles: 'identified_only',
    capture_pageview: true,
    capture_pageleave: true,
    autocapture: false,
    session_recording: { maskAllInputs: true },
  });
  initialized = true;
}

type DemoErrorType = 'too_long' | 'rate_limit' | 'budget_exceeded';
type CtaButtonLocation = 'hero' | 'demo_section' | 'bottom_cta' | 'header';
type CtaButtonType = 'primary_cta' | 'demo_scroll';

/**
 * Optional `tenantSlug` (e.g. `'demo-women-clothes'`, `'demo-cosmetics'`) is
 * attached to all demo-* events as a property so PostHog dashboards can split
 * funnels by demo tenant. Omitting it keeps the event tenant-agnostic for the
 * landing-level events (e.g. demo_section_visible fires before any tab choice).
 */
export const analytics = {
  demoSectionVisible(): void {
    if (!initialized) return;
    posthog.capture('demo_section_visible');
  },
  demoViewed(source: 'landing', tenantSlug?: string): void {
    if (!initialized) return;
    sessionStorage.setItem('demo_viewed_fired', '1');
    posthog.capture('demo_viewed', { source, tenantSlug });
  },
  demoTabSwitched(tenantSlug: string): void {
    if (!initialized) return;
    posthog.capture('demo_tab_switched', { tenantSlug });
  },
  demoScenarioClicked(scenario: string, tenantSlug?: string): void {
    if (!initialized) return;
    sessionStorage.setItem('demo_interacted', '1');
    posthog.capture('demo_scenario_clicked', { scenario, tenantSlug });
  },
  demoLiveModeStarted(tenantSlug?: string): void {
    if (!initialized) return;
    posthog.capture('demo_live_mode_started', { tenantSlug });
  },
  demoMessageSent(messageIndex: number, isAggregated: boolean, tenantSlug?: string): void {
    if (!initialized) return;
    sessionStorage.setItem('demo_interacted', '1');
    posthog.capture('demo_message_sent', { messageIndex, isAggregated, tenantSlug });
  },
  demoErrorReceived(errorType: DemoErrorType, tenantSlug?: string): void {
    if (!initialized) return;
    posthog.capture('demo_error_received', { errorType, tenantSlug });
  },
  ctaClicked(buttonLocation: CtaButtonLocation, buttonType: CtaButtonType): void {
    if (!initialized) return;
    posthog.capture('cta_clicked', { buttonLocation, buttonType });
    if (sessionStorage.getItem('demo_viewed_fired') === '1') {
      posthog.capture('demo_cta_clicked', {
        buttonLocation,
        interactedWithDemo: sessionStorage.getItem('demo_interacted') === '1',
      });
    }
  },
};
