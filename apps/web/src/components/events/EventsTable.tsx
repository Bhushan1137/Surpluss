'use client';

import { RotateCw, ChevronRight } from 'lucide-react';
import { WebhookEvent } from '@surpluss/shared';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatDateTime, formatRelativeTime } from '@/lib/format';

interface EventsTableProps {
  events: WebhookEvent[];
  onSelectEvent: (event: WebhookEvent) => void;
  onRequestRetry?: (event: WebhookEvent) => void;
  retryingId?: string | null;
  selectedEventId?: string;
  hasActiveFilters?: boolean;
  onClearFilters?: () => void;
}

export function EventsTable({
  events,
  onSelectEvent,
  onRequestRetry,
  retryingId,
  selectedEventId,
  hasActiveFilters,
  onClearFilters,
}: EventsTableProps) {
  if (events.length === 0) {
    return (
      <EmptyState
        title={hasActiveFilters ? 'No matching events' : 'No webhook events yet'}
        description={
          hasActiveFilters
            ? 'Try adjusting or clearing your search and status filters.'
            : 'Send a POST request to /webhooks to see events stream into the pipeline.'
        }
        action={
          hasActiveFilters && onClearFilters
            ? { label: 'Clear filters', onClick: onClearFilters }
            : undefined
        }
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-left">
        <thead className="bg-slate-50/80">
          <tr>
            <th scope="col" className="px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
              Event ID
            </th>
            <th scope="col" className="px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
              Event Type
            </th>
            <th scope="col" className="px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider hidden md:table-cell">
              Order ID
            </th>
            <th scope="col" className="px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
              Status
            </th>
            <th scope="col" className="px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
              Attempts
            </th>
            <th scope="col" className="px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider hidden sm:table-cell">
              Received
            </th>
            <th scope="col" className="px-4 py-2.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider hidden lg:table-cell">
              Last Updated
            </th>
            <th scope="col" className="px-4 py-2.5 text-right text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
              Actions
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-slate-100">
          {events.map((event) => {
            const isSelected = selectedEventId === event.id;
            const isFailed = event.status === 'FAILED';
            const isRetrying = retryingId === event.id;

            return (
              <tr
                key={event.id}
                tabIndex={0}
                onClick={() => onSelectEvent(event)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectEvent(event);
                  }
                }}
                className={`group cursor-pointer transition-colors focus:outline-none focus:bg-slate-50 ${
                  isSelected
                    ? 'bg-slate-50 ring-1 ring-inset ring-slate-300'
                    : 'hover:bg-slate-50/80'
                }`}
              >
                <td className="px-4 py-3 whitespace-nowrap">
                  <span
                    className="text-xs font-mono font-medium text-slate-900 truncate block max-w-[180px] sm:max-w-[220px]"
                    title={event.eventId}
                  >
                    {event.eventId}
                  </span>
                  {event.lastError && (
                    <span
                      className="text-[11px] text-red-600 truncate block max-w-[180px] sm:max-w-[220px] mt-0.5"
                      title={event.lastError}
                    >
                      {event.lastError}
                    </span>
                  )}
                </td>

                <td className="px-4 py-3 whitespace-nowrap">
                  <span className="inline-flex items-center px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-xs font-mono">
                    {event.type}
                  </span>
                </td>

                <td className="px-4 py-3 whitespace-nowrap hidden md:table-cell">
                  {event.orderId ? (
                    <span
                      className="text-xs font-mono text-slate-600 truncate block max-w-[140px]"
                      title={event.orderId}
                    >
                      {event.orderId}
                    </span>
                  ) : (
                    <span className="text-xs text-slate-300">—</span>
                  )}
                </td>

                <td className="px-4 py-3 whitespace-nowrap">
                  <StatusBadge status={event.status} />
                </td>

                <td className="px-4 py-3 whitespace-nowrap">
                  <span className="text-xs font-mono tabular-nums text-slate-700">
                    {event.attemptCount}
                    <span className="text-slate-400"> / {event.maxAttempts}</span>
                  </span>
                </td>

                <td className="px-4 py-3 whitespace-nowrap hidden sm:table-cell">
                  <span
                    className="text-xs text-slate-500"
                    title={formatDateTime(event.createdAt)}
                  >
                    {formatRelativeTime(event.createdAt)}
                  </span>
                </td>

                <td className="px-4 py-3 whitespace-nowrap hidden lg:table-cell">
                  <span
                    className="text-xs text-slate-500"
                    title={formatDateTime(event.updatedAt)}
                  >
                    {formatRelativeTime(event.updatedAt)}
                  </span>
                </td>

                <td
                  className="px-4 py-3 whitespace-nowrap text-right"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="inline-flex items-center gap-1.5">
                    {isFailed && onRequestRetry && (
                      <button
                        type="button"
                        disabled={isRetrying}
                        onClick={() => onRequestRetry(event)}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 rounded hover:bg-amber-100 disabled:opacity-50 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500"
                        aria-label={`Retry event ${event.eventId}`}
                      >
                        <RotateCw
                          className={`w-3 h-3 ${isRetrying ? 'animate-spin' : ''}`}
                          aria-hidden="true"
                        />
                        <span>Retry</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onSelectEvent(event)}
                      className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400"
                      aria-label={`Inspect event ${event.eventId}`}
                    >
                      <ChevronRight className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
