'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  EventStats,
  PaginatedResponse,
  WebhookEvent,
  EventListQuery,
} from '@surpluss/shared';
import { eventsApi, EventDetailResponse } from '@/services/api';

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

export function useEventStats(refreshIntervalMs = 5000) {
  const [stats, setStats] = useState<EventStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchStats = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await eventsApi.getStats(signal);
      setStats(data);
      setError(null);
      setLastUpdated(new Date());
    } catch (err) {
      if (isAbortError(err)) return;
      setError(err instanceof Error ? err.message : 'Failed to load stats');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchStats(controller.signal);
    const interval = setInterval(() => fetchStats(), refreshIntervalMs);
    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [fetchStats, refreshIntervalMs]);

  return { stats, error, loading, lastUpdated, refetch: () => fetchStats() };
}

export function useEvents(query: EventListQuery = {}, refreshIntervalMs = 5000) {
  const [data, setData] = useState<PaginatedResponse<WebhookEvent> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const queryRef = useRef(query);
  queryRef.current = query;

  const fetchEvents = useCallback(async (signal?: AbortSignal) => {
    try {
      const result = await eventsApi.list(queryRef.current, signal);
      setData(result);
      setError(null);
    } catch (err) {
      if (isAbortError(err)) return;
      setError(err instanceof Error ? err.message : 'Failed to load events');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetchEvents(controller.signal);
    return () => controller.abort();
  }, [
    query.page,
    query.pageSize,
    query.status,
    query.type,
    query.search,
    query.sortBy,
    query.sortOrder,
    fetchEvents,
  ]);

  useEffect(() => {
    const interval = setInterval(() => fetchEvents(), refreshIntervalMs);
    return () => clearInterval(interval);
  }, [fetchEvents, refreshIntervalMs]);

  return { data, error, loading, refetch: () => fetchEvents() };
}

export function useEventDetails(id: string | null) {
  const [event, setEvent] = useState<EventDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchDetail = useCallback(
    async (signal?: AbortSignal) => {
      if (!id) return;
      setLoading(true);
      try {
        const data = await eventsApi.getOne(id, signal);
        setEvent(data);
        setError(null);
      } catch (err) {
        if (isAbortError(err)) return;
        setError(err instanceof Error ? err.message : 'Failed to load event');
      } finally {
        setLoading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    if (!id) {
      setEvent(null);
      setError(null);
      return;
    }
    const controller = new AbortController();
    fetchDetail(controller.signal);
    return () => controller.abort();
  }, [id, fetchDetail]);

  return { event, error, loading, refetch: () => fetchDetail() };
}

export function useRetryEvent() {
  const [retrying, setRetrying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const retry = useCallback(async (id: string, onSuccess?: () => void) => {
    if (retrying === id) return false;
    setRetrying(id);
    setError(null);
    try {
      await eventsApi.retry(id);
      onSuccess?.();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Retry failed');
      return false;
    } finally {
      setRetrying(null);
    }
  }, [retrying]);

  const clearError = useCallback(() => setError(null), []);

  return { retry, retrying, error, clearError };
}
