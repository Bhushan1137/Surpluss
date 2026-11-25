'use client';

import { Search, RefreshCw, X } from 'lucide-react';
import { EventSortField, EventStatus, SortOrder } from '@surpluss/shared';

interface EventFiltersProps {
  status?: EventStatus;
  type?: string;
  search?: string;
  sortBy: EventSortField;
  sortOrder: SortOrder;
  eventTypes: string[];
  onStatusChange: (status: EventStatus | undefined) => void;
  onTypeChange: (type: string | undefined) => void;
  onSearchChange: (search: string) => void;
  onSortChange: (sortBy: EventSortField, sortOrder: SortOrder) => void;
  onClearFilters: () => void;
  onRefresh: () => void;
  isRefreshing?: boolean;
}

const STATUS_OPTIONS: Array<{ value: EventStatus | ''; label: string }> = [
  { value: '', label: 'All Statuses' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'PROCESSING', label: 'Processing' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'RETRY_PENDING', label: 'Retry Pending' },
  { value: 'FAILED', label: 'Failed' },
];

const SORT_OPTIONS: Array<{ value: string; label: string; sortBy: EventSortField; sortOrder: SortOrder }> = [
  { value: 'createdAt:desc', label: 'Newest first', sortBy: 'createdAt', sortOrder: 'desc' },
  { value: 'createdAt:asc', label: 'Oldest first', sortBy: 'createdAt', sortOrder: 'asc' },
  { value: 'updatedAt:desc', label: 'Recently updated', sortBy: 'updatedAt', sortOrder: 'desc' },
  { value: 'attemptCount:desc', label: 'Most attempts', sortBy: 'attemptCount', sortOrder: 'desc' },
];

export function EventFilters({
  status,
  type,
  search,
  sortBy,
  sortOrder,
  eventTypes,
  onStatusChange,
  onTypeChange,
  onSearchChange,
  onSortChange,
  onClearFilters,
  onRefresh,
  isRefreshing,
}: EventFiltersProps) {
  const hasActiveFilters = Boolean(status || type || (search && search.trim().length > 0));
  const currentSort = `${sortBy}:${sortOrder}`;

  return (
    <div className="flex flex-col lg:flex-row gap-2.5 items-stretch lg:items-center">
      <div className="relative flex-1 min-w-0">
        <Search
          className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
          aria-hidden="true"
        />
        <input
          type="text"
          aria-label="Search events by ID or type"
          placeholder="Search by event ID or type..."
          value={search ?? ''}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full pl-9 pr-3 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 border border-slate-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/15 focus:border-slate-400 transition-colors"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Filter by status"
          value={status ?? ''}
          onChange={(e) =>
            onStatusChange((e.target.value as EventStatus) || undefined)
          }
          className="px-2.5 py-1.5 text-sm text-slate-700 border border-slate-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/15 focus:border-slate-400"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by event type"
          value={type ?? ''}
          onChange={(e) => onTypeChange(e.target.value || undefined)}
          className="px-2.5 py-1.5 text-sm text-slate-700 border border-slate-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/15 focus:border-slate-400"
        >
          <option value="">All Types</option>
          {eventTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

        <select
          aria-label="Sort events"
          value={currentSort}
          onChange={(e) => {
            const match = SORT_OPTIONS.find((o) => o.value === e.target.value);
            if (match) onSortChange(match.sortBy, match.sortOrder);
          }}
          className="px-2.5 py-1.5 text-sm text-slate-700 border border-slate-200 rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/15 focus:border-slate-400"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={onClearFilters}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
            Clear
          </button>
        )}

        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          aria-label="Refresh events"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 disabled:opacity-50 transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          <span>Refresh</span>
        </button>
      </div>
    </div>
  );
}
