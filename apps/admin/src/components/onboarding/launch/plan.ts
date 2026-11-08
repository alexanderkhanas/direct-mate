import { useQuery } from '@tanstack/react-query';
import { api } from '../../../lib/api';

/** GET /subscriptions/plan, the fields setup reads. */
export interface SubscriptionPlanInfo {
  plan: { planType: string } | null;
  /** False while a trial waits for go-live. */
  trialStarted: boolean;
}

export function useSubscriptionPlan() {
  return useQuery<SubscriptionPlanInfo>({
    queryKey: ['subscription-plan'],
    queryFn: () => api.get('/subscriptions/plan').then((r) => r.data),
  });
}

/** The cheapest paid plan in hryvnias (the API sends kopecks), or null until the plans load. */
export function useCheapestPrice(): number | null {
  const { data } = useQuery<Array<{ planType: string; price: number }>>({
    queryKey: ['available-plans'],
    queryFn: () => api.get('/subscriptions/plans').then((r) => r.data),
  });
  const prices = (data ?? []).map((p) => p.price).filter((price) => price > 0);
  return prices.length ? Math.min(...prices) / 100 : null;
}
