'use client';

import { formatDateTime, formatDuration } from '@/lib/format';

interface Attempt {
  id: string;
  attemptNumber: number;
  workerId: string;
  startedAt: string;
  finishedAt: string | null;
  result: 'SUCCESS' | 'FAILURE' | null;
  errorDetails: string | null;
}

interface AttemptTimelineProps {
  attempts: Attempt[];
}

export function AttemptTimeline({ attempts }: AttemptTimelineProps) {
  return (
    <ol className="relative border-l border-slate-200 space-y-4 pl-5 ml-1.5">
      {attempts.map((attempt) => (
        <li key={attempt.id} className="relative">
          <div
            className={`absolute -left-[25px] top-1.5 w-3 h-3 rounded-full ring-4 ring-white ${
              attempt.result === 'SUCCESS'
                ? 'bg-emerald-500'
                : attempt.result === 'FAILURE'
                ? 'bg-red-500'
                : 'bg-blue-500 animate-pulse'
            }`}
          />

          <div className="bg-slate-50/80 rounded-lg border border-slate-200 p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-xs font-semibold text-slate-800">
                Attempt #{attempt.attemptNumber}
              </span>
              <span
                className={`text-[11px] font-medium px-2 py-0.5 rounded border ${
                  attempt.result === 'SUCCESS'
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : attempt.result === 'FAILURE'
                    ? 'bg-red-50 text-red-700 border-red-200'
                    : 'bg-blue-50 text-blue-700 border-blue-200'
                }`}
              >
                {attempt.result ?? 'IN PROGRESS'}
              </span>
            </div>

            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <div className="flex items-center gap-1.5">
                <dt className="text-slate-400">Worker:</dt>
                <dd className="font-mono text-slate-700 truncate" title={attempt.workerId}>
                  {attempt.workerId}
                </dd>
              </div>
              <div className="flex items-center gap-1.5">
                <dt className="text-slate-400">Duration:</dt>
                <dd className="font-mono tabular-nums text-slate-700">
                  {formatDuration(attempt.startedAt, attempt.finishedAt)}
                </dd>
              </div>
              <div className="flex items-center gap-1.5">
                <dt className="text-slate-400">Started:</dt>
                <dd className="text-slate-600">{formatDateTime(attempt.startedAt)}</dd>
              </div>
              {attempt.finishedAt && (
                <div className="flex items-center gap-1.5">
                  <dt className="text-slate-400">Finished:</dt>
                  <dd className="text-slate-600">{formatDateTime(attempt.finishedAt)}</dd>
                </div>
              )}
            </dl>

            {attempt.errorDetails && (
              <div className="mt-2.5 bg-red-50 border border-red-200 rounded px-2.5 py-1.5">
                <p className="text-xs text-red-700 font-mono break-words">
                  {attempt.errorDetails}
                </p>
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
