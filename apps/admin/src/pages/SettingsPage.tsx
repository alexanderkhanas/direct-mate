import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Trash2, Crown, ArrowRight, Check } from 'lucide-react';
import { api } from '../lib/api';
import { TenantSettings } from '../types';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { LoadingState } from '../components/ui/Spinner';
import { useT } from '../i18n';
import {
  BrandToneSection,
  ExamplesSection,
  KnowledgeSection,
  SizingSection,
} from '../components/settings/StoreSettingsSections';

type OperatingMode = 'learning' | 'active' | 'paused';

interface StoreConfigData {
  operatingMode: OperatingMode;
  learningStartedAt: string | null;
}

function OperatingModeSection() {
  const { t } = useT();
  const qc = useQueryClient();
  const { data: config } = useQuery<StoreConfigData>({
    queryKey: ['engine-config'],
    queryFn: () => api.get('/engine/config').then((r) => r.data),
  });

  const save = useMutation({
    mutationFn: (mode: OperatingMode) => api.patch('/engine/config', { operatingMode: mode }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['engine-config'] }),
  });

  const currentMode: OperatingMode = config?.operatingMode ?? 'active';
  // The API refuses to turn the bot on until the store has what it needs to answer.
  const notReady: string[] = save.isError ? ((save.error as any)?.response?.data?.error?.details?.missing ?? []) : [];

  const modes: { value: OperatingMode; label: string; desc: string }[] = [
    { value: 'learning', label: t('operating_mode.learning'), desc: t('operating_mode.learning_desc') },
    { value: 'active', label: t('operating_mode.active'), desc: t('operating_mode.active_desc') },
    { value: 'paused', label: t('operating_mode.paused'), desc: t('operating_mode.paused_desc') },
  ];

  return (
    <Card>
      <h2 className="text-sm font-semibold text-gray-900 mb-1">{t('operating_mode.title')}</h2>
      <p className="text-xs text-gray-500 mb-4">{t('operating_mode.subtitle')}</p>
      <div className="space-y-2">
        {modes.map((m) => (
          <button
            key={m.value}
            onClick={() => {
              if (m.value === 'active' && currentMode === 'learning') {
                if (!window.confirm(t('operating_mode.go_live_confirm'))) return;
              }
              save.mutate(m.value);
            }}
            className={`w-full text-left p-3 rounded-lg border transition-colors ${
              currentMode === m.value
                ? 'border-amber-400 bg-amber-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-gray-900">{m.label}</span>
              {currentMode === m.value && (
                <span className="w-2 h-2 rounded-full bg-amber-400" />
              )}
            </div>
            <p className="text-xs text-gray-500 mt-0.5">{m.desc}</p>
          </button>
        ))}
      </div>
      {currentMode === 'learning' && config?.learningStartedAt && (
        <p className="text-xs text-gray-400 mt-3">
          {t('operating_mode.learning_since', {
            date: new Date(config.learningStartedAt).toLocaleDateString(),
          })}
        </p>
      )}
      {save.isSuccess && (
        <p className="text-xs text-emerald-600 mt-2">{t('operating_mode.saved')}</p>
      )}
      {notReady.length > 0 && (
        <p className="text-xs text-red-600 mt-2">
          {t('operating_mode.not_ready')}{' '}
          {notReady.map((m) => t(`operating_mode.requirement_${m}`)).join(', ')}.
        </p>
      )}
    </Card>
  );
}

function SubscriptionSection() {
  const { t } = useT();
  const qc = useQueryClient();

  const { data: planData } = useQuery<{
    plan: { planType: string; status: string; trialEndsAt: string | null; currentPeriodEnd: string | null } | null;
    usage: { used: number; limit: number | null; percentUsed: number | null };
    planConfig: { displayName: string; price: number; conversationLimit: number | null } | null;
    trialDaysRemaining: number | null;
  }>({
    queryKey: ['subscription-plan'],
    queryFn: () => api.get('/subscriptions/plan').then(r => r.data),
  });

  const { data: configs } = useQuery<Array<{
    planType: string; displayName: string; price: number; conversationLimit: number | null; igAccountsLimit: number;
  }>>({
    queryKey: ['available-plans'],
    queryFn: () => api.get('/subscriptions/plans').then(r => r.data),
  });

  const upgrade = useMutation({
    mutationFn: (planType: string) => api.post('/subscriptions/upgrade', { planType }).then(r => r.data),
    onSuccess: (data: { pageUrl: string }) => {
      window.location.href = data.pageUrl;
    },
  });

  const cancel = useMutation({
    mutationFn: () => api.post('/subscriptions/cancel'),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['subscription-plan'] }),
  });

  const plan = planData?.plan;
  const usage = planData?.usage;
  const trialDays = planData?.trialDaysRemaining;

  const statusColor = !plan ? 'bg-gray-100 text-gray-500'
    : plan.status === 'active' && plan.planType === 'trial' ? 'bg-amber-50 text-amber-700'
    : plan.status === 'active' ? 'bg-emerald-50 text-emerald-700'
    : plan.status === 'past_due' ? 'bg-red-50 text-red-700'
    : 'bg-gray-100 text-gray-500';

  return (
    <Card>
      <div className="flex items-center gap-2 mb-4">
        <Crown className="h-4 w-4 text-amber-500" />
        <h2 className="text-sm font-semibold text-gray-900">{t('settings_ext.subscription_title')}</h2>
        {plan && (
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ml-auto ${statusColor}`}>
            {plan.planType === 'trial' ? 'Trial' : planData?.planConfig?.displayName ?? plan.planType} · {plan.status}
          </span>
        )}
      </div>

      {/* Trial countdown */}
      {plan?.planType === 'trial' && trialDays != null && (
        <div className={`rounded-lg p-3 mb-4 ${trialDays <= 3 ? 'bg-red-50 border border-red-200' : 'bg-amber-50 border border-amber-200'}`}>
          <p className={`text-sm font-medium ${trialDays <= 3 ? 'text-red-700' : 'text-amber-700'}`}>
            {trialDays > 0 ? `${trialDays} ${t('settings_ext.trial_days_left')}` : t('settings_ext.trial_expired')}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">{t('settings_ext.trial_upgrade_hint')}</p>
        </div>
      )}

      {/* Usage bar */}
      {usage && usage.limit && (
        <div className="mb-4">
          <div className="flex justify-between text-xs text-gray-500 mb-1">
            <span>{t('settings_ext.conversations_this_month')}</span>
            <span>{usage.used} / {usage.limit}</span>
          </div>
          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${(usage.percentUsed ?? 0) > 100 ? 'bg-red-500' : (usage.percentUsed ?? 0) > 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
              style={{ width: `${Math.min(usage.percentUsed ?? 0, 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Current period */}
      {plan?.currentPeriodEnd && plan.planType !== 'trial' && (
        <p className="text-xs text-gray-400 mb-4">
          {t('settings_ext.next_billing')}: {new Date(plan.currentPeriodEnd).toLocaleDateString()}
        </p>
      )}

      {/* Plan cards */}
      {configs && configs.length > 0 && (
        <div className="space-y-2 mb-4">
          <p className="text-xs font-medium text-gray-600">{plan?.planType === 'trial' ? t('settings_ext.choose_plan') : t('settings_ext.change_plan')}</p>
          <div className="grid grid-cols-3 gap-2">
            {configs.map(cfg => {
              const isCurrent = plan?.planType === cfg.planType;
              return (
                <button
                  key={cfg.planType}
                  onClick={() => !isCurrent && upgrade.mutate(cfg.planType)}
                  disabled={isCurrent || upgrade.isPending}
                  className={`text-left p-3 rounded-lg border transition-colors ${
                    isCurrent
                      ? 'border-emerald-300 bg-emerald-50'
                      : 'border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 cursor-pointer'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-gray-900">{cfg.displayName}</p>
                    {isCurrent && <Check className="h-3.5 w-3.5 text-emerald-600" />}
                  </div>
                  <p className="text-lg font-bold text-gray-900 mt-1">{(cfg.price / 100).toFixed(0)} <span className="text-xs font-normal text-gray-400">UAH/mo</span></p>
                  <p className="text-xs text-gray-400 mt-1">
                    {cfg.conversationLimit ? `${cfg.conversationLimit} convs` : 'Unlimited'} · {cfg.igAccountsLimit} IG
                  </p>
                  {!isCurrent && (
                    <span className="text-xs text-indigo-600 font-medium mt-2 inline-flex items-center gap-1">
                      {t('settings_ext.upgrade_button')} <ArrowRight className="h-3 w-3" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Cancel */}
      {plan && plan.planType !== 'trial' && plan.status === 'active' && (
        <button
          onClick={() => { if (window.confirm(t('settings_ext.cancel_confirm'))) cancel.mutate(); }}
          className="text-xs text-gray-400 hover:text-red-500 transition-colors"
        >
          {t('settings_ext.cancel_subscription')}
        </button>
      )}
      {cancel.isSuccess && <p className="text-xs text-gray-500 mt-1">{t('settings_ext.cancel_success')}</p>}
    </Card>
  );
}

function DeleteAccountSection() {
  const { t } = useT();
  const [confirmText, setConfirmText] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);

  const deleteAccount = useMutation({
    mutationFn: () => api.delete('/auth/account'),
    onSuccess: () => {
      localStorage.removeItem('accessToken');
      window.location.href = '/welcome';
    },
  });

  return (
    <Card>
      <h2 className="text-sm font-semibold text-red-600 mb-1">{t('settings_ext.delete_account_title')}</h2>
      <p className="text-xs text-gray-500 mb-4">{t('settings_ext.delete_account_desc')}</p>

      {!showConfirm ? (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setShowConfirm(true)}
          className="text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300"
        >
          <Trash2 className="h-3.5 w-3.5" />
          {t('settings_ext.delete_account_button')}
        </Button>
      ) : (
        <div className="p-4 bg-red-50 rounded-lg border border-red-200 space-y-3">
          <p className="text-sm text-red-700">{t('settings_ext.delete_account_warning')}</p>
          <Input
            label={t('settings_ext.delete_account_confirm_label')}
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder="DELETE"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => deleteAccount.mutate()}
              loading={deleteAccount.isPending}
              disabled={confirmText !== 'DELETE'}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {t('settings_ext.delete_account_confirm')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setShowConfirm(false); setConfirmText(''); }}>
              {t('common.cancel')}
            </Button>
          </div>
          {deleteAccount.isError && (
            <p className="text-xs text-red-600">{t('settings_ext.delete_account_error')}</p>
          )}
        </div>
      )}
    </Card>
  );
}

export default function SettingsPage() {
  const { t } = useT();
  const { data, isLoading } = useQuery<TenantSettings>({
    queryKey: ['settings'],
    queryFn: () => api.get('/settings').then((r) => r.data),
  });

  if (isLoading) return <LoadingState />;
  if (!data) return null;

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">{t('settings.title')}</h1>
        <p className="text-sm text-gray-500 mt-1">{t('settings_ext.configure_subtitle')}</p>
      </div>
      <OperatingModeSection />
      <BrandToneSection settings={data} />
      <KnowledgeSection />
      <SizingSection />
      <ExamplesSection />
      <SubscriptionSection />
      <DeleteAccountSection />
    </div>
  );
}
