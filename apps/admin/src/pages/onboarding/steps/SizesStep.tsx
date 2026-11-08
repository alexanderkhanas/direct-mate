import { SizeChartFlowBody } from '../../../components/size-charts/SizeChartFlowBody';
import { useSizeChartFlow } from '../../../components/size-charts/useSizeChartFlow';
import { useSetup, useSetupStep } from '../SetupContext';

/**
 * Розміри (m30–m34, d30): upload a chart → which products it covers → the
 * AI reads it → the owner checks the table → the saved charts. Opens on the
 * saved charts when there are some, and on the check screen when a chart
 * was read but not checked yet. «Немає сітки» leaves size advice to a
 * manager and moves on.
 */
export default function SizesStep() {
  const { refresh, goNext } = useSetup();
  const flow = useSizeChartFlow({ inSetup: true, refresh });
  const inner = flow.view === 'scope' || flow.view === 'reading' || flow.view === 'check';

  useSetupStep({
    primary: flow.primary,
    onBack: flow.back ?? undefined,
    back: flow.view === 'reading' ? false : undefined,
    // «Пропустити» belongs to the start screen; the inner screens have one way forward.
    skip: inner ? false : undefined,
    width: flow.view === 'check' ? 'wide' : undefined,
  });

  const noChart = async () => {
    try {
      await flow.chooseNoChart();
      goNext();
    } catch {
      // The start screen shows that it failed.
    }
  };

  return <SizeChartFlowBody flow={flow} onNoChart={noChart} />;
}
