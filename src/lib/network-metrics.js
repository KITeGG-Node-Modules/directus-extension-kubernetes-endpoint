// SPDX-License-Identifier: EUPL-1.2
// Pod network I/O from cAdvisor (scraped by Prometheus via the kubelet).
// Neither the metrics-server nor the kubelet stats summary carry network
// counters — Prometheus is the only source.

// Cumulative bytes since pod start, per pod (summed over containers)
export const NETWORK_RECEIVE_METRIC = 'container_network_receive_bytes_total'
export const NETWORK_TRANSMIT_METRIC = 'container_network_transmit_bytes_total'

import { promqlString } from './prometheus.js'

/**
 * Instant queries for the current network I/O of pods matching the
 * selector: transfer rates (bytes/s, rate over the given window) plus
 * the cumulative counters. Network is a pod-level concept, so rows are
 * summed per pod.
 */
export function networkCurrentQueries(podSelector, rateWindowSeconds = 300) {
  // promqlString: the selector is a PromQL string literal — a verbatim
  // `\d` from the pod regex is an unknown escape sequence there (see
  // lib/prometheus.js)
  const labels = `pod=~${promqlString(podSelector)}`
  const sumByPod = 'sum by (pod)'
  return {
    receiveRate: `${sumByPod} (rate(${NETWORK_RECEIVE_METRIC}{${labels}}[${rateWindowSeconds}s]))`,
    transmitRate: `${sumByPod} (rate(${NETWORK_TRANSMIT_METRIC}{${labels}}[${rateWindowSeconds}s]))`,
    receiveTotal: `${sumByPod} (${NETWORK_RECEIVE_METRIC}{${labels}})`,
    transmitTotal: `${sumByPod} (${NETWORK_TRANSMIT_METRIC}{${labels}})`,
  }
}

/**
 * Range queries for network transfer rates (bytes/s) per pod — the time
 * series counterpart of the rate part above.
 */
export function networkRateQueries(podSelector, rateWindowSeconds) {
  // promqlString: see networkCurrentQueries
  const labels = `pod=~${promqlString(podSelector)}`
  const sumByPod = 'sum by (pod)'
  return {
    receiveRate: `${sumByPod} (rate(${NETWORK_RECEIVE_METRIC}{${labels}}[${rateWindowSeconds}s]))`,
    transmitRate: `${sumByPod} (rate(${NETWORK_TRANSMIT_METRIC}{${labels}}[${rateWindowSeconds}s]))`,
  }
}

/**
 * Combine network query results (matrix `values` or vector `value`
 * form) into per-pod records:
 *
 *   { pod, receive: [[epochSeconds, bytes/s or bytes], ...],
 *          transmit: [[epochSeconds, ...], ...] }
 *
 * The caller decides what the sample values mean (rates or totals) by
 * which query results it passes in.
 */
export function collectNetworkSeries(receiveEntries, transmitEntries) {
  const pods = new Map()
  const ensure = (metric) => {
    const pod = metric.pod || null
    if (!pods.has(pod)) {
      pods.set(pod, { pod, receive: [], transmit: [] })
    }
    return pods.get(pod)
  }
  const addSamples = (entry, samples) => {
    const values = entry.values ?? (entry.value ? [entry.value] : [])
    for (const [timestamp, value] of values) {
      samples.push([Number(timestamp), Number(value)])
    }
  }
  for (const entry of receiveEntries ?? []) {
    addSamples(entry, ensure(entry.metric ?? {}).receive)
  }
  for (const entry of transmitEntries ?? []) {
    addSamples(entry, ensure(entry.metric ?? {}).transmit)
  }
  return [...pods.values()].sort((a, b) =>
    (a.pod ?? '').localeCompare(b.pod ?? '')
  )
}
