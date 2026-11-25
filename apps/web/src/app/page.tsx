'use client';

import { useState, useCallback } from 'react';
import { AlertCircle, CheckCircle2, RefreshCw, Webhook } from 'lucide-react';
import {
  EventSortField,
  EventStatus,
  SortOrder,
  WebhookEvent,
} from '@surpluss/shared';
import { useEventStats, useEvents, useRetryEvent } from '@/hooks';
import { StatsGrid } from '@/components/ui/StatCard';
import { StatsSkeleton, LoadingSkeleton } from '@/components/ui/LoadingSkeleton';
import { EventsTable } from '@/components/events/EventsTable';
import { EventFilters } from '@/components/events/EventFilters';
import { EventDetailsDrawer } from '@/components/events/EventDetailsDrawer';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Pagination } from '@/components/ui/Pagination';
import { formatDateTime } from '@/lib/format';

export default function DashboardPage() {
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [status, setStatus] = useState<EventStatus | undefined>();
  const [type, setType] = useState<string | undefined>();
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<EventSortField>('createdAt');
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [retryTarget, setRetryTarget] = useState<WebhookEvent | null>(null);
  const [toast, setToast] = useState<{ kind: 'success' | 'error'; message: string } | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const {
    stats,
    error: statsError,
    loading: statsLoading,
    lastUpdated,
    refetch: refetchStats,
  } = useEventStats(5000);

  const {
    data,
    error: eventsError,
    loading: eventsLoading,
    refetch: refetchEvents,
  } = useEvents(
    { page, pageSize, status, type, search, sortBy, sortOrder },
    5000,
  );

  const { retry, retrying } = useRetryEvent();

  const handleStatusChange = useCallback((s: EventStatus | undefined) => {
    setStatus(s);
    setPage(1);
  }, []);

  const handleTypeChange = useCallback((t: string | undefined) => {
    setType(t);
    setPage(1);
  }, []);

  const handleSearchChange = useCallback((s: string) => {
    setSearch(s);
    setPage(1);
  }, []);

  const handleSortChange = useCallback(
    (field: EventSortField, order: SortOrder) => {
      setSortBy(field);
      setSortOrder(order);
      setPage(1);
    },
    [],
  );

  const handleClearFilters = useCallback(() => {
    setStatus(undefined);
    setType(undefined);
    setSearch('');
    setPage(1);
  }, []);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    await Promise.all([refetchStats(), refetchEvents()]);
    setIsRefreshing(false);
  }, [refetchStats, refetchEvents]);

  const handleConfirmInlineRetry = useCallback(async () => {
    if (!retryTarget || retrying === retryTarget.id) return;
    const target = retryTarget;
    const ok = await retry(target.id, () => {
      setToast({
        kind: 'success',
        message: `Queued "${target.eventId}" for retry with a fresh retry budget.`,
      });
      refetchEvents();
      refetchStats();
    });
    if (!ok) {
      setToast({
        kind: 'error',
        message: `Failed to retry "${target.eventId}". It may no longer be in FAILED status.`,
      });
    }
    setRetryTarget(null);
  }, [retryTarget, retrying, retry, refetchEvents, refetchStats]);

  const handleDrawerRetrySuccess = useCallback(
    (eventId: string) => {
      setToast({
        kind: 'success',
        message: `Queued "${eventId}" for retry with a fresh retry budget.`,
      });
      refetchEvents();
      refetchStats();
    },
    [refetchEvents, refetchStats],
  );

  const hasActiveFilters = Boolean(status || type || search.trim().length > 0);
  const apiError = statsError || eventsError;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Top Navigation */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-20">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-3.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center shrink-0">
              <Webhook className="w-4 h-4" aria-hidden="true" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-base font-semibold text-slate-900 tracking-tight">
                  Surpluss
                </h1>
                <span className="text-slate-300">/</span>
                <span className="text-sm font-medium text-slate-600">
                  Webhook Operations
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Real-time ingestion, lease coordination, and retry observability
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {lastUpdated && (
              <span className="text-xs text-slate-400 hidden sm:inline">
                Updated {formatDateTime(lastUpdated.toISOString())}
              </span>
            )}
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-md font-medium">
              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
              Auto-sync
            </span>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 disabled:opacity-50 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`}
                aria-hidden="true"
              />
              Refresh
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Global Error / Feedback Banners */}
        {apiError && (
          <div
            role="alert"
            className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-2.5">
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" aria-hidden="true" />
              <p className="text-xs font-medium text-red-800">
                API connection error: {apiError}
              </p>
            </div>
            <button
              type="button"
              onClick={handleRefresh}
              className="text-xs font-medium text-red-700 hover:text-red-900 underline"
            >
              Retry
            </button>
          </div>
        )}

        {toast && (
          <div
            role="status"
            className={`rounded-lg px-4 py-3 border flex items-center justify-between gap-3 ${
              toast.kind === 'success'
                ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                : 'bg-red-50 border-red-200 text-red-800'
            }`}
          >
            <div className="flex items-center gap-2">
              {toast.kind === 'success' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
              ) : (
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0" aria-hidden="true" />
              )}
              <p className="text-xs font-medium">{toast.message}</p>
            </div>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="text-xs opacity-70 hover:opacity-100"
              aria-label="Dismiss notification"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Overview Metrics */}
        <section aria-label="Pipeline overview">
          {statsLoading || !stats ? <StatsSkeleton /> : <StatsGrid stats={stats} />}
        </section>

        {/* Events Management Table */}
        <section aria-label="Webhook events">
          <div className="bg-white rounded-lg border border-slate-200 shadow-2xs overflow-hidden">
            <div className="px-4 sm:px-6 py-4 border-b border-slate-200 space-y-3.5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Events</h2>
                  <p className="text-xs text-slate-500">
                    Click any row to inspect payload, worker lease, and attempt timeline
                  </p>
                </div>
                {data && (
                  <span className="text-xs font-mono text-slate-500 tabular-nums">
                    {data.total.toLocaleString()} matching
                  </span>
                )}
              </div>
              <EventFilters
                status={status}
                type={type}
                search={search}
                sortBy={sortBy}
                sortOrder={sortOrder}
                eventTypes={stats?.eventTypes ?? []}
                onStatusChange={handleStatusChange}
                onTypeChange={handleTypeChange}
                onSearchChange={handleSearchChange}
                onSortChange={handleSortChange}
                onClearFilters={handleClearFilters}
                onRefresh={handleRefresh}
                isRefreshing={isRefreshing}
              />
            </div>

            <div className="min-h-[320px]">
              {eventsLoading && !data ? (
                <div className="p-6">
                  <LoadingSkeleton rows={8} />
                </div>
              ) : (
                <EventsTable
                  events={data?.data ?? []}
                  onSelectEvent={(ev) => setSelectedEventId(ev.id)}
                  onRequestRetry={(ev) => setRetryTarget(ev)}
                  retryingId={retrying}
                  selectedEventId={selectedEventId ?? undefined}
                  hasActiveFilters={hasActiveFilters}
                  onClearFilters={handleClearFilters}
                />
              )}
            </div>

            {data && (
              <Pagination
                page={page}
                totalPages={data.totalPages}
                total={data.total}
                pageSize={pageSize}
                onPageChange={setPage}
              />
            )}
          </div>
        </section>
      </main>

      {selectedEventId && (
        <EventDetailsDrawer
          eventId={selectedEventId}
          onClose={() => setSelectedEventId(null)}
          onRetrySuccess={handleDrawerRetrySuccess}
        />
      )}

      <ConfirmDialog
        isOpen={Boolean(retryTarget)}
        title="Retry Permanently Failed Event"
        description={`Retrying "${retryTarget?.eventId}" assigns a fresh retry budget starting from attempt #${(retryTarget?.attemptCount ?? 0) + 1}. Original payload and attempt history are preserved.`}
        confirmLabel="Start Retry Cycle"
        loading={Boolean(retryTarget && retrying === retryTarget.id)}
        onConfirm={handleConfirmInlineRetry}
        onCancel={() => setRetryTarget(null)}
      />
    </div>
  );
}
