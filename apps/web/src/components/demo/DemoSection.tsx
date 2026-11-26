import { useEffect, useMemo, useRef, useState } from 'react';
import { Shirt, Sparkles } from '../icons';
import { Tabs } from '../ui/Tabs';
import { DemoWidget } from './DemoWidget';
import { getScenariosForTenant, type DemoTenantSlug } from './scenarios';
import { analytics } from '../../lib/analytics';

const DEMO_TABS: Array<{ value: DemoTenantSlug; label: string; icon: React.ReactNode; brandName: string }> = [
  { value: 'demo-women-clothes', label: 'Жіночий одяг', icon: <Shirt className="h-3.5 w-3.5" />, brandName: 'StyleBoutique UA' },
  { value: 'demo-cosmetics', label: 'Косметика', icon: <Sparkles className="h-3.5 w-3.5" />, brandName: 'Glow Cosmetics' },
];

/** The home page's demo: a store to pick, then the live chat with that demo store's AI agent (POST /api/demo/message). */
export default function DemoSection() {
  const [tenantSlug, setTenantSlug] = useState<DemoTenantSlug>('demo-women-clothes');
  const scenarios = useMemo(() => getScenariosForTenant(tenantSlug), [tenantSlug]);
  const brandName = DEMO_TABS.find((tab) => tab.value === tenantSlug)?.brandName;

  const handleTabChange = (slug: DemoTenantSlug) => {
    setTenantSlug(slug);
    analytics.demoTabSwitched(slug);
  };

  // demo_section_visible: once per session, after 1 s with at least 30 % of the demo on screen.
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (sessionStorage.getItem('demo_section_visible_fired') === '1') return;
    const el = ref.current;
    if (!el) return;
    let timer: number | null = null;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          timer ??= window.setTimeout(() => {
            sessionStorage.setItem('demo_section_visible_fired', '1');
            analytics.demoSectionVisible();
            observer.disconnect();
          }, 1000);
        } else if (timer != null) {
          clearTimeout(timer);
          timer = null;
        }
      },
      { threshold: 0.3 },
    );
    observer.observe(el);
    return () => {
      if (timer != null) clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  return (
    <div ref={ref}>
      <Tabs<DemoTenantSlug>
        value={tenantSlug}
        onChange={handleTabChange}
        options={DEMO_TABS.map(({ value, label, icon }) => ({ value, label, icon }))}
        ariaLabel="Демо-магазин"
      />
      {/* A fresh widget per store, so messages and playback reset on a switch. */}
      <DemoWidget key={tenantSlug} tenantSlug={tenantSlug} scenarios={scenarios} brandName={brandName} />
    </div>
  );
}
