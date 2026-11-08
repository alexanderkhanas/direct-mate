import { type IconComponent } from '../icons';
import { InboxIcon } from '../icons';

interface EmptyStateProps {
  icon?: IconComponent;
  title: string;
  description?: string;
}

export function EmptyState({ icon: Icon = InboxIcon, title, description }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <Icon className="h-10 w-10 text-gray-300 mb-3" />
      <p className="text-sm font-medium text-gray-600">{title}</p>
      {description && <p className="text-sm text-gray-400 mt-1">{description}</p>}
    </div>
  );
}
