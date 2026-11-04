// SPDX-License-Identifier: EUPL-1.2

const PROMETHEUS_TIMEOUT_MS = 10_000

/**
 * Run one query against the Prometheus HTTP API and return the raw
 * `data.result` — a matrix (`[{ metric, values: [[ts, "value"], ...] }]`)
 * for query_range, a vector (`[{ metric, value: [ts, "value"] }]`) for
 * instant queries.
 */
export async function prometheusQuery(baseUrl, path, params) {
  const url = new URL(path, baseUrl)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(PROMETHEUS_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`Prometheus API returned HTTP ${response.status}`)
  }
  const payload = await response.json()
  if (payload.status !== 'success') {
    throw new Error(payload.error ?? 'Prometheus query failed')
  }
  return payload.data?.result ?? []
}
