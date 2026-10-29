import type { Account, Ack, Page, Pending, ServerDraft } from './types'

export class APIError extends Error {
  constructor(
    public status: number,
    public code: string,
    public requestId = '',
  ) {
    super(code)
  }
}
export async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      signal: AbortSignal.timeout(8_000),
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new APIError(0, 'network_unconfirmed')
  }
  if (!response.ok) {
    const failure = await response.json().catch(() => ({ error: 'service_unavailable' }))
    throw new APIError(
      response.status,
      failure.error,
      failure.request_id ?? response.headers.get('X-Request-ID') ?? '',
    )
  }
  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}
export const syncAPI = {
  me: () => request<Account>('/me'),
  read: (id: string) => request<ServerDraft>(`/drafts/${encodeURIComponent(id)}`),
  write: (pending: Pending) => {
    const { kind, ...body } = pending
    return request<Ack>(`/drafts/${kind}`, 'POST', body)
  },
}
export const listDrafts = (cursor = '') =>
  request<Page>(`/drafts?limit=20&cursor=${encodeURIComponent(cursor)}`)
