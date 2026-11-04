// SPDX-License-Identifier: EUPL-1.2
// GPU usage metrics from dcgm-exporter (deployed with the NVIDIA GPU
// operator and scraped by Prometheus). GPU utilization is invisible to
// the metrics-server and cAdvisor — DCGM is the only source.

import { promqlString } from './prometheus.js'

// Whole-GPU utilization in percent (0-100)
export const GPU_UTIL_METRIC = 'DCGM_FI_DEV_GPU_UTIL'
// MIG-partitioned GPUs frequently do not expose DCGM_FI_DEV_GPU_UTIL;
// the profile-based engine-active fraction (0..1, scaled ×100 here) is
// the usable substitute
export const GPU_PROF_METRIC = 'DCGM_FI_PROF_GR_ENGINE_ACTIVE'
// Framebuffer usage; DCGM reports it in MiB
export const GPU_FB_USED_METRIC = 'DCGM_FI_DEV_FB_USED'
// Framebuffer free — together with FB_USED this yields the device's
// actual capacity (for a MIG slice: the slice's size, not the whole
// GPU's)
export const GPU_FB_FREE_METRIC = 'DCGM_FI_DEV_FB_FREE'

const MIB = 1024 ** 2

/**
 * DCGM queries for the pods matching the selector, aggregated per GPU
 * device. The exporter's kubernetes mapping adds pod labels; grouping
 * keeps `pod` so devices can be attributed to individual pods (null when
 * the exporter runs without pod mapping).
 */
export function gpuDeviceQueries(podSelector) {
  // promqlString: the selector is a PromQL string literal — a verbatim
  // `\d` from the pod regex is an unknown escape sequence there (see
  // lib/prometheus.js)
  const labels = `pod=~${promqlString(podSelector)}`
  // GPU_I_PROFILE/GPU_I_ID identify the MIG slice a series belongs to;
  // keeping them in the aggregation preserves that context
  const aggregation =
    'max by (gpu, UUID, modelName, pod, GPU_I_PROFILE, GPU_I_ID)'
  return {
    utilization: `${aggregation} (${GPU_UTIL_METRIC}{${labels}})`,
    profileUtilization: `${aggregation} (${GPU_PROF_METRIC}{${labels}})`,
    memory: `${aggregation} (${GPU_FB_USED_METRIC}{${labels}})`,
    memoryFree: `${aggregation} (${GPU_FB_FREE_METRIC}{${labels}})`,
  }
}

/**
 * Combine DCGM query results (matrix `values` or vector `value` form)
 * into device records grouped by GPU (UUID + MIG instance if present):
 *
 *   { pod, gpu, uuid, gpuInstanceId, migProfile, modelName,
 *     utilization: [[epochSeconds, percent], ...],   // 0-100
 *     memoryBytes: [[epochSeconds, bytes], ...],     // MiB → bytes
 *     capacityBytes: [[epochSeconds, bytes], ...] }  // used + free
 *
 * migProfile/gpuInstanceId identify the MIG slice (e.g. '1g.10gb');
 * capacityBytes is computed per timestamp as FB_USED + FB_FREE — for a
 * MIG device that is the slice's size, so usage can be shown against
 * the allocated slice rather than the whole GPU. The profile-based
 * utilization metric is only used when the whole-GPU metric returned
 * nothing (MIG partitioning).
 */
export function collectGpuDevices(
  utilizationEntries,
  profileUtilizationEntries,
  memoryEntries,
  freeEntries = []
) {
  const devices = new Map()
  const keyOf = (metric) =>
    `${metric.UUID ?? metric.gpu ?? ''}|${metric.GPU_I_ID ?? ''}`
  const ensure = (metric) => {
    const key = keyOf(metric)
    if (!devices.has(key)) {
      devices.set(key, {
        pod: metric.pod || null,
        gpu: metric.gpu ?? null,
        uuid: metric.UUID ?? null,
        gpuInstanceId: metric.GPU_I_ID ?? null,
        migProfile: metric.GPU_I_PROFILE ?? null,
        modelName: metric.modelName ?? null,
        utilization: [],
        memoryBytes: [],
        freeBytes: [],
      })
    }
    return devices.get(key)
  }
  const addSamples = (entry, samples, scale = 1) => {
    const values = entry.values ?? (entry.value ? [entry.value] : [])
    for (const [timestamp, value] of values) {
      samples.push([Number(timestamp), Number(value) * scale])
    }
  }

  for (const entry of utilizationEntries ?? []) {
    addSamples(entry, ensure(entry.metric ?? {}).utilization)
  }
  if (!utilizationEntries?.length) {
    for (const entry of profileUtilizationEntries ?? []) {
      addSamples(entry, ensure(entry.metric ?? {}).utilization, 100)
    }
  }
  for (const entry of memoryEntries ?? []) {
    addSamples(entry, ensure(entry.metric ?? {}).memoryBytes, MIB)
  }
  for (const entry of freeEntries ?? []) {
    addSamples(entry, ensure(entry.metric ?? {}).freeBytes, MIB)
  }

  // Capacity per timestamp where used and free meet (same scrape) —
  // null-capacity samples are dropped rather than guessed
  for (const device of devices.values()) {
    const freeByTimestamp = new Map(
      device.freeBytes.map(([timestamp, value]) => [timestamp, value])
    )
    device.capacityBytes = device.memoryBytes
      .map(([timestamp, used]) =>
        freeByTimestamp.has(timestamp)
          ? [timestamp, used + freeByTimestamp.get(timestamp)]
          : null
      )
      .filter(Boolean)
    delete device.freeBytes
  }
  return [...devices.values()].sort(
    (a, b) =>
      (a.pod ?? '').localeCompare(b.pod ?? '') ||
      (a.gpu ?? '').localeCompare(b.gpu ?? '')
  )
}

/**
 * The most recent sample value of a series, or null — the current-usage
 * counterpart for instant queries in the stats endpoint.
 */
export function latestSample(samples) {
  return samples.length ? samples.at(-1)[1] : null
}
