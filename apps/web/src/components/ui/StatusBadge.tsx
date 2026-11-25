import clsx from 'clsx';
import {
  CheckCircle2,
  Loader2,
  Clock,
  RotateCw,
  AlertCircle,
} from 'lucide-react';
import { EventStatus } from '@surpluss/shared';

const statusConfig: Record<
  EventStatus,
  { label: string; style: string; Icon: typeof CheckCircle2; spin?: boolean }
> = {
  COMPLETED: {
    label: 'Completed',
    style: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    Icon: CheckCircle2,
  },
  PROCESSING: {
    label: 'Processing',
    style: 'bg-blue-50 text-blue-700 border-blue-200',
    Icon: Loader2,
    spin: true,
  },
  PENDING: {
    label: 'Pending',
    style: 'bg-slate-100 text-slate-700 border-slate-200',
    Icon: Clock,
  },
  RETRY_PENDING: {
    label: 'Retry Pending',
    style: 'bg-amber-50 text-amber-800 border-amber-200',
    Icon: RotateCw,
  },
  FAILED: {
    label: 'Failed',
    style: 'bg-red-50 text-red-700 border-red-200',
    Icon: AlertCircle,
  },
};

interface StatusBadgeProps {
  status: EventStatus;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const { label, style, Icon, spin } = statusConfig[status];
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-xs font-medium border whitespace-nowrap',
        style,
        className,
      )}
    >
      <Icon className={clsx('w-3.5 h-3.5 shrink-0', spin && 'animate-spin')} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}
