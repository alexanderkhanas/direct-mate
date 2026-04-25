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

export const analytics = {
  demoSectionVisible(): void {
    if (!initialized) return;
    posthog.capture('demo_section_visible');
  },
  demoViewed(source: 'landing'): void {
    if (!initialized) return;
    sessionStorage.setItem('demo_viewed_fired', '1');
    posthog.capture('demo_viewed', { source });
  },
  demoScenarioClicked(scenario: string): void {
    if (!initialized) return;
    sessionStorage.setItem('demo_interacted', '1');
    posthog.capture('demo_scenario_clicked', { scenario });
  },
  demoLiveModeStarted(): void {
    if (!initialized) return;
    posthog.capture('demo_live_mode_started');
  },
  demoMessageSent(messageIndex: number, isAggregated: boolean): void {
    if (!initialized) return;
    sessionStorage.setItem('demo_interacted', '1');
    posthog.capture('demo_message_sent', { messageIndex, isAggregated });
  },
  demoErrorReceived(errorType: DemoErrorType): void {
    if (!initialized) return;
    posthog.capture('demo_error_received', { errorType });
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
