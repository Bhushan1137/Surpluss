'use client';

import { useEffect, useState } from 'react';
import { X, RotateCw, AlertCircle, CheckCircle2 } from 'lucide-react';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { JsonViewer } from '@/components/ui/JsonViewer';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { AttemptTimeline } from '@/components/events/AttemptTimeline';
import { useEventDetails, useRetryEvent } from '@/hooks';
import { formatDateTime } from '@/lib/format';

interface EventDetailsDrawerProps {
  eventId: string | null;
  onClose: () => void;
  onRetrySuccess: (eventId: string) => void;
}

export function EventDetailsDrawer({
  eventId,
  onClose,
  onRetrySuccess,
}: EventDetailsDrawerProps) {
  const { event, loading, error, refetch } = useEventDetails(eventId);
  const { retry, retrying, error: retryError, clearError } = useRetryEvent();
  const [confirmRetry, setConfirmRetry] = useState(false);
  const [retryFeedback, setRetryFeedback] = useState<string | null>(null);

  useEffect(() => {
    setRetryFeedback(null);
    clearError();
  }, [eventId, clearError]);

  useEffect(() => {
    if (!eventId) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !confirmRetry) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [eventId, confirmRetry, onClose]);

  if (!eventId) return null;

  const canRetry = event?.status === 'FAILED';
  const isRetryingThis = retrying === event?.id;

  const handleRetry = async () => {
    if (!event || isRetryingThis) return;
    const ok = await retry(event.id, () => {
      setRetryFeedback('Event re-queued with a fresh retry budget.');
      onRetrySuccess(event.eventId);
      refetch();
      setConfirmRetry(false);
    });
    if (!ok) {
      setConfirmRetry(false);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 bg-slate-900/40 backdrop-blur-[1px] z-30"
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Event details"
        className="fixed right-0 top-0 h-full w-full max-w-2xl bg-white shadow-2xl border-l border-slate-200 z-40 flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-6 py-4 border-b border-slate-200 bg-slate-50/70">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900">Event Details</h2>
            {event && (
              <p className="text-xs text-slate-500 font-mono truncate mt-0.5" title={event.eventId}>
                {event.eventId}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {canRetry && (
              <button
                type="button"
                onClick={() => setConfirmRetry(true)}
                disabled={isRetryingThis}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-slate-900 rounded-md hover:bg-slate-800 disabled:opacity-50 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-500"
              >
                <RotateCw
                  className={`w-3.5 h-3.5 ${isRetryingThis ? 'animate-spin' : ''}`}
                  aria-hidden="true"
                />
                {isRetryingThis ? 'Retrying…' : 'Manual Retry'}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-200/70 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400"
              aria-label="Close details drawer"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading && !event && <LoadingSkeleton rows={6} />}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3.5 flex items-start gap-2.5" role="alert">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" aria-hidden="true" />
              <p className="text-xs text-red-700">{error}</p>
            </div>
          )}

          {retryError && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3.5 flex items-start gap-2.5" role="alert">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" aria-hidden="true" />
              <p className="text-xs text-red-700">{retryError}</p>
            </div>
          )}

          {retryFeedback && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3.5 flex items-start gap-2.5" role="status">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
              <p className="text-xs text-emerald-800">{retryFeedback}</p>
            </div>
          )}

          {event && (
            <>
              {/* 1. Event Overview */}
              <section>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                  1. Event Overview
                </h3>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-slate-50/70 border border-slate-200 rounded-lg p-4 text-xs">
                  <div>
                    <dt className="text-slate-500 mb-1">Current Status</dt>
                    <dd><StatusBadge status={event.status} /></dd>
                  </div>
                  <div>
                    <dt className="text-slate-500 mb-1">Event Type</dt>
                    <dd className="font-mono font-medium text-slate-800">{event.type}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500 mb-1">Order ID</dt>
                    <dd className="font-mono text-slate-800">{event.orderId ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500 mb-1">Attempts</dt>
                    <dd className="font-mono font-medium text-slate-800 tabular-nums">
                      {event.attemptCount} / {event.maxAttempts}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500 mb-1">Received At</dt>
                    <dd className="text-slate-700">{formatDateTime(event.createdAt)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500 mb-1">Last Updated</dt>
                    <dd className="text-slate-700">{formatDateTime(event.updatedAt)}</dd>
                  </div>
                </dl>
              </section>

              {/* 2. Error Details */}
              {event.lastError && (
                <section>
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                    2. Error Details
                  </h3>
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3.5">
                    <p className="text-xs text-red-700 font-mono break-words">{event.lastError}</p>
                  </div>
                </section>
              )}

              {/* 3. Processing Information */}
              <section>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                  {event.lastError ? '3. Processing Information' : '2. Processing Information'}
                </h3>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 border border-slate-200 rounded-lg p-4 text-xs">
                  <div>
                    <dt className="text-slate-500 mb-0.5">Active Worker</dt>
                    <dd className="font-mono text-slate-800">{event.workerId ?? '—'}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500 mb-0.5">Lease Expires</dt>
                    <dd className="text-slate-700">
                      {event.leaseExpiresAt ? formatDateTime(event.leaseExpiresAt) : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500 mb-0.5">Next Retry</dt>
                    <dd className="text-slate-700">
                      {event.nextRetryAt ? formatDateTime(event.nextRetryAt) : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500 mb-0.5">Completed At</dt>
                    <dd className="text-slate-700">
                      {event.processedAt ? formatDateTime(event.processedAt) : '—'}
                    </dd>
                  </div>
                  {event.processedOrder && (
                    <div className="sm:col-span-2 pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <span className="text-slate-500">Processed Order Record: </span>
                        <span className="font-mono font-medium text-emerald-700">
                          {event.processedOrder.orderId}
                        </span>
                      </div>
                      <span className="text-slate-500">
                        {formatDateTime(event.processedOrder.processedAt)}
                      </span>
                    </div>
                  )}
                </dl>
              </section>

              {/* 4. Original Payload */}
              <section>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                  {event.lastError ? '4. Original Payload' : '3. Original Payload'}
                </h3>
                <JsonViewer data={event.payload} title="Immutable Webhook Payload" />
              </section>

              {/* 5. Attempt History */}
              <section>
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                  {event.lastError ? '5. Attempt History' : '4. Attempt History'} ({event.attempts.length})
                </h3>
                {event.attempts.length === 0 ? (
                  <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-4">
                    No processing attempts recorded yet.
                  </p>
                ) : (
                  <AttemptTimeline attempts={event.attempts} />
                )}
              </section>
            </>
          )}
        </div>
      </aside>

      <ConfirmDialog
        isOpen={confirmRetry}
        title="Retry Permanently Failed Event"
        description={`Retrying "${event?.eventId}" assigns a fresh retry budget (${event ? event.maxAttempts - event.attemptCount || 5 : 5} new attempts) starting from attempt #${(event?.attemptCount ?? 0) + 1}. Original payload and attempt history are preserved.`}
        confirmLabel="Start Retry Cycle"
        loading={isRetryingThis}
        onConfirm={handleRetry}
        onCancel={() => setConfirmRetry(false)}
      />
    </>
  );
}
