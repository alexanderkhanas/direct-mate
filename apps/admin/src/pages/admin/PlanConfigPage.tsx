import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { api } from '../../lib/api';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { LoadingState } from '../../components/ui/Spinner';

interface PlanConfig {
  id: string;
  planType: string;
  displayName: string;
  price: number;
  currency: number;
  conversationLimit: number | null;
  igAccountsLimit: number;
  productsLimit: number | null;
  connectionsLimit: number;
  teamMembersLimit: number;
  historyDays: number;
  isActive: boolean;
  sortOrder: number;
}

function formatPrice(kopiyky: number): string {
  return (kopiyky / 100).toFixed(0);
}

export default function PlanConfigPage() {
  const qc = useQueryClient();
  const { data: configs, isLoading } = useQuery<PlanConfig[]>({
    queryKey: ['admin-plan-configs'],
    queryFn: () => api.get('/admin/plan-configs').then(r => r.data),
  });

  if (isLoading) return <LoadingState />;

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Subscription Plans</h1>
        <p className="text-sm text-gray-500 mt-1">Manage pricing and limits for each plan tier</p>
      </div>

      <div className="grid gap-4">
        {configs?.map(config => (
          <PlanConfigCard key={config.id} config={config} />
        ))}
      </div>
    </div>
  );
}

function PlanConfigCard({ config }: { config: PlanConfig }) {
  const qc = useQueryClient();
  const [price, setPrice] = useState(formatPrice(config.price));
  const [convLimit, setConvLimit] = useState(config.conversationLimit?.toString() ?? '');
  const [igLimit, setIgLimit] = useState(config.igAccountsLimit.toString());
  const [productsLimit, setProductsLimit] = useState(config.productsLimit?.toString() ?? '');
  const [connectionsLimit, setConnectionsLimit] = useState(config.connectionsLimit.toString());
  const [teamLimit, setTeamLimit] = useState(config.teamMembersLimit.toString());
  const [historyDays, setHistoryDays] = useState(config.historyDays.toString());
  const [isActive, setIsActive] = useState(config.isActive);

  const save = useMutation({
    mutationFn: () => api.patch(`/admin/plan-configs/${config.planType}`, {
      price: parseInt(price, 10) * 100, // UAH → kopiyky
      conversationLimit: convLimit === '' ? null : parseInt(convLimit, 10),
      igAccountsLimit: parseInt(igLimit, 10),
      productsLimit: productsLimit === '' ? null : parseInt(productsLimit, 10),
      connectionsLimit: parseInt(connectionsLimit, 10),
      teamMembersLimit: parseInt(teamLimit, 10),
      historyDays: parseInt(historyDays, 10),
      isActive,
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-plan-configs'] }),
  });

  return (
    <Card>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h3 className="text-base font-semibold text-gray-900">{config.displayName}</h3>
          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-mono">{config.planType}</span>
          {!isActive && <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-600">Inactive</span>}
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <span className="text-xs text-gray-500">Active</span>
          <button
            role="switch"
            aria-checked={isActive}
            onClick={() => setIsActive(!isActive)}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${isActive ? 'bg-gray-900' : 'bg-gray-200'}`}
          >
            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${isActive ? 'translate-x-4' : 'translate-x-1'}`} />
          </button>
        </label>
      </div>

      <div className="grid grid-cols-4 gap-3">
        <Field label="Price (UAH)" value={price} onChange={setPrice} type="number" />
        <Field label="Conversations/mo" value={convLimit} onChange={setConvLimit} placeholder="unlimited" type="number" />
        <Field label="IG accounts" value={igLimit} onChange={setIgLimit} type="number" />
        <Field label="Products" value={productsLimit} onChange={setProductsLimit} placeholder="unlimited" type="number" />
        <Field label="Connections" value={connectionsLimit} onChange={setConnectionsLimit} type="number" />
        <Field label="Team members" value={teamLimit} onChange={setTeamLimit} type="number" />
        <Field label="History (days)" value={historyDays} onChange={setHistoryDays} type="number" />
      </div>

      <div className="flex items-center gap-3 mt-4">
        <Button onClick={() => save.mutate()} loading={save.isPending} size="sm">
          <Save className="h-3.5 w-3.5" />
          Save
        </Button>
        {save.isSuccess && <span className="text-xs text-emerald-600">Saved</span>}
      </div>
    </Card>
  );
}

function Field({ label, value, onChange, placeholder, type }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">{label}</label>
      <input
        type={type ?? 'text'}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-2.5 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900"
      />
    </div>
  );
}
