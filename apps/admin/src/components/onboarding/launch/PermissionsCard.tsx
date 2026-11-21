import { useT } from '../../../i18n';
import { cn } from '../../../lib/cn';
import { Alert, Card, CheckRow } from '../../setup/ui';
import { useDirectPermissions, type DirectPermission } from '../directPermissions';

const ORDER: DirectPermission[] = ['reply_to_customers', 'read_messages'];

/**
 * «Дозволи для Instagram» on the launch step: the owner's two permissions, each
 * its own tick. `highlight` marks the one the button just pressed needs.
 */
export function PermissionsCard({ highlight }: { highlight?: DirectPermission | null }) {
  const { t } = useT();
  const { permissions, set } = useDirectPermissions();
  if (!permissions) return null;

  return (
    <Card className={cn(highlight && 'border-blue-300 ring-4 ring-blue-50')}>
      <div className="flex flex-col gap-1">
        <b className="text-[15px] font-semibold text-dm-ink">{t('setup_launch.perm_title')}</b>
        <p className="text-sm text-dm-muted">{t('setup_launch.perm_lead')}</p>
      </div>
      <div className="flex flex-col gap-2">
        {ORDER.map((p) => (
          <CheckRow
            key={p}
            checked={permissions[p].allowed}
            onChange={(allowed) => set.mutate({ permission: p, allowed })}
            description={t(`setup_launch.perm_${p}_desc`)}
          >
            {t(`setup_launch.perm_${p}`)}
          </CheckRow>
        ))}
      </div>
      {set.isError && <Alert tone="error" title={t('setup_launch.perm_failed')} />}
    </Card>
  );
}
