import clsx from 'clsx';
import {
  Activity,
  CheckCircle2,
  Loader2,
  RotateCw,
  AlertCircle,
  LucideIcon,
} from 'lucide-react';
import { EventStats } from '@surpluss/shared';

interface StatCardProps {
  label: string;
  value: number;
  icon: LucideIcon;
  accentClass: string;
  iconBgClass: string;
  subtext?: string;
}

export function StatCard({
  label,
  value,
  icon: Icon,
  accentClass,
  iconBgClass,
  subtext,
}: StatCardProps) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-2xs hover:border-slate-300 transition-colors">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-slate-500 uppercase tracking-wider truncate">
          {label}
        </p>
        <div className={clsx('p-1.5 rounded-md', iconBgClass)}>
          <Icon className={clsx('w-4 h-4', accentClass)} aria-hidden="true" />
        </div>
      </div>
      <p className={clsx('mt-2 text-2xl font-semibold tabular-nums tracking-tight', accentClass)}>
        {value.toLocaleString()}
      </p>
      {subtext && (
        <p className="mt-1 text-xs text-slate-500 truncate">{subtext}</p>
      )}
    </div>
  );
}

interface StatsGridProps {
  stats: EventStats;
}

export function StatsGrid({ stats }: StatsGridProps) {
  const completionRate =
    stats.total > 0 ? ((stats.completed / stats.total) * 100).toFixed(1) : '0.0';
  const failureRate =
    stats.total > 0 ? ((stats.failed / stats.total) * 100).toFixed(1) : '0.0';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3.5">
        <StatCard
          label="Total Events"
          value={stats.total}
          icon={Activity}
          accentClass="text-slate-900"
          iconBgClass="bg-slate-100"
          subtext={`${stats.pending.toLocaleString()} queued pending`}
        />
        <StatCard
          label="Completed"
          value={stats.completed}
          icon={CheckCircle2}
          accentClass="text-emerald-700"
          iconBgClass="bg-emerald-50"
          subtext={`${completionRate}% of total`}
        />
        <StatCard
          label="Processing"
          value={stats.processing}
          icon={Loader2}
          accentClass="text-blue-700"
          iconBgClass="bg-blue-50"
          subtext="Active worker leases"
        />
        <StatCard
          label="Retry Pending"
          value={stats.retryPending}
          icon={RotateCw}
          accentClass="text-amber-700"
          iconBgClass="bg-amber-50"
          subtext="Awaiting backoff window"
        />
        <StatCard
          label="Permanently Failed"
          value={stats.failed}
          icon={AlertCircle}
          accentClass="text-red-700"
          iconBgClass="bg-red-50"
          subtext={`${failureRate}% failure rate`}
        />
      </div>

      {/* Activity & Status Distribution Bar */}
      {stats.total > 0 && (
        <div className="bg-white rounded-lg border border-slate-200 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <span className="text-xs font-medium text-slate-600">
              Pipeline Distribution
            </span>
            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                Completed ({stats.completed})
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-blue-500" />
                Processing ({stats.processing})
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                Retry ({stats.retryPending})
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-slate-400" />
                Pending ({stats.pending})
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-500" />
                Failed ({stats.failed})
              </span>
            </div>
          </div>
          <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden flex">
            {stats.completed > 0 && (
              <div
                className="bg-emerald-500 h-full transition-all"
                style={{ width: `${(stats.completed / stats.total) * 100}%` }}
                title={`Completed: ${stats.completed}`}
              />
            )}
            {stats.processing > 0 && (
              <div
                className="bg-blue-500 h-full transition-all"
                style={{ width: `${(stats.processing / stats.total) * 100}%` }}
                title={`Processing: ${stats.processing}`}
              />
            )}
            {stats.retryPending > 0 && (
              <div
                className="bg-amber-500 h-full transition-all"
                style={{ width: `${(stats.retryPending / stats.total) * 100}%` }}
                title={`Retry Pending: ${stats.retryPending}`}
              />
            )}
            {stats.pending > 0 && (
              <div
                className="bg-slate-400 h-full transition-all"
                style={{ width: `${(stats.pending / stats.total) * 100}%` }}
                title={`Pending: ${stats.pending}`}
              />
            )}
            {stats.failed > 0 && (
              <div
                className="bg-red-500 h-full transition-all"
                style={{ width: `${(stats.failed / stats.total) * 100}%` }}
                title={`Failed: ${stats.failed}`}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
