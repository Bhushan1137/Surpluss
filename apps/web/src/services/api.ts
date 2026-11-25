import {
  WebhookEvent,
  EventStats,
  PaginatedResponse,
  EventListQuery,
  ApiResponse,
} from '@surpluss/shared';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
  });

  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const parsed = (await response.json()) as { message?: string };
      if (parsed?.message) message = parsed.message;
    } catch {
      const text = await response.text();
      if (text) message = text;
    }
    throw new Error(message);
  }

  return response.json() as Promise<T>;
}

export interface EventDetailResponse extends WebhookEvent {
  attempts: Array<{
    id: string;
    eventId: string;
    attemptNumber: number;
    workerId: string;
    startedAt: string;
    finishedAt: string | null;
    result: 'SUCCESS' | 'FAILURE' | null;
    errorDetails: string | null;
  }>;
  processedOrder: {
    id: string;
    orderId: string;
    eventId: string;
    processedAt: string;
  } | null;
}

export const eventsApi = {
  list(
    query: EventListQuery = {},
    signal?: AbortSignal,
  ): Promise<PaginatedResponse<WebhookEvent>> {
    const params = new URLSearchParams();
    if (query.page) params.set('page', String(query.page));
    if (query.pageSize) params.set('pageSize', String(query.pageSize));
    if (query.status) params.set('status', query.status);
    if (query.type) params.set('type', query.type);
    if (query.search) params.set('search', query.search);
    if (query.sortBy) params.set('sortBy', query.sortBy);
    if (query.sortOrder) params.set('sortOrder', query.sortOrder);

    const qs = params.toString();
    return apiFetch<PaginatedResponse<WebhookEvent>>(
      `/events${qs ? `?${qs}` : ''}`,
      { signal },
    );
  },

  getOne(id: string, signal?: AbortSignal): Promise<EventDetailResponse> {
    return apiFetch<EventDetailResponse>(`/events/${id}`, { signal });
  },

  getStats(signal?: AbortSignal): Promise<EventStats> {
    return apiFetch<EventStats>('/events/stats', { signal });
  },

  retry(id: string): Promise<ApiResponse<WebhookEvent>> {
    return apiFetch<ApiResponse<WebhookEvent>>(`/events/${id}/retry`, {
      method: 'POST',
    });
  },
};
