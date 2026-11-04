// SPDX-License-Identifier: EUPL-1.2

const PROMETHEUS_TIMEOUT_MS = 10_000
const ERROR_BODY_MAX_CHARS = 300

/**
 * Render a value as a double-quoted PromQL string literal.
 *
 * PromQL parses string literals BEFORE handing their contents to the
 * regex engine, so a regex like `^sd-5-\d+$` must arrive with the
 * backslash doubled (`^sd-5-\\d+$`) — a single `\d` is rejected as an
 * unknown escape sequence and the whole query fails with HTTP 400.
 * Embedding regex sources verbatim is exactly the bug this prevents.
 *
 * JSON.stringify escaping (backslash, quote, control characters) is
 * exactly what a PromQL double-quoted string literal requires.
 */
export function promqlString(value) {
  return JSON.stringify(value)
}

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
    // Include the error body (parse errors, invalid parameters, ...) —
    // the HTTP status alone made Prometheus rejections undiagnosable
    // from the endpoint's degradation warnings
    let body = ''
    try {
      const text = await response.text()
      try {
        body = JSON.parse(text).error ?? text
      } catch {
        body = text
      }
    } catch {
      // unreadable body — the status alone still beats nothing
    }
    body = body.trim().slice(0, ERROR_BODY_MAX_CHARS)
    throw new Error(
      `Prometheus API returned HTTP ${response.status}${body ? `: ${body}` : ''}`
    )
  }
  const payload = await response.json()
  if (payload.status !== 'success') {
    throw new Error(payload.error ?? 'Prometheus query failed')
  }
  return payload.data?.result ?? []
}
