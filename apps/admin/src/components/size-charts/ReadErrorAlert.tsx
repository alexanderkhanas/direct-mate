import { Alert } from '../setup/ui';
import { SetUpForMeButton } from '../onboarding/SetUpForMeButton';
import { useT } from '../../i18n';

const KNOWN = ['not_a_chart', 'image_missing', 'read_failed'];

/** Why a chart couldn't be read (the API's `details.reason`), how to fix it, and the free-setup link. */
export function ReadErrorAlert({ reason }: { reason: string }) {
  const { t } = useT();
  const key = KNOWN.includes(reason) ? reason : 'read_failed';
  return (
    <Alert tone="error" title={t(`setup_sizes.${key}_title`)} action={<SetUpForMeButton look="inline" step="sizes" />}>
      {t(`setup_sizes.${key}_text`)}
    </Alert>
  );
}
