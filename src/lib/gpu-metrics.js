// SPDX-License-Identifier: EUPL-1.2
// GPU usage metrics from dcgm-exporter (deployed with the NVIDIA GPU
// operator and scraped by Prometheus). GPU utilization is invisible to
// the metrics-server and cAdvisor — DCGM is the only source.

// Whole-GPU utilization in percent (0-100)
export const GPU_UTIL_METRIC = 'DCGM_FI_DEV_GPU_UTIL'
// MIG-partitioned GPUs frequently do not expose DCGM_FI_DEV_GPU_UTIL;
// the profile-based engine-active fraction (0..1, scaled ×100 here) is
// the usable substitute
export const GPU_PROF_METRIC = 'DCGM_FI_PROF_GR_ENGINE_ACTIVE'
// Framebuffer usage; DCGM reports it in MiB
export const GPU_FB_USED_METRIC = 'DCGM_FI_DEV_FB_USED'

const MIB = 1024 ** 2

/**
 * DCGM queries for the pods matching the selector, aggregated per GPU
 * device. The exporter's kubernetes mapping adds pod labels; grouping
 * keeps `pod` so devices can be attributed to individual pods (null when
 * the exporter runs without pod mapping).
 */
export function gpuDeviceQueries(podSelector) {
  const labels = `pod=~"${podSelector}"`
  const aggregation = 'max by (gpu, UUID, modelName, pod)'
  return {
    utilization: `${aggregation} (${GPU_UTIL_METRIC}{${labels}})`,
    profileUtilization: `${aggregation} (${GPU_PROF_METRIC}{${labels}})`,
    memory: `${aggregation} (${GPU_FB_USED_METRIC}{${labels}})`,
  }
}

/**
 * Combine DCGM query results (matrix `values` or vector `value` form)
 * into device records grouped by GPU (UUID if present, else device
 * index):
 *
 *   { pod, gpu, uuid, modelName,
 *     utilization: [[epochSeconds, percent], ...],   // 0-100
 *     memoryBytes: [[epochSeconds, bytes], ...] }    // MiB → bytes
 *
 * The profile-based utilization metric is only used when the whole-GPU
 * metric returned nothing (MIG partitioning).
 */
export function collectGpuDevices(
  utilizationEntries,
  profileUtilizationEntries,
  memoryEntries
) {
  const devices = new Map()
  const keyOf = (metric) => `${metric.UUID ?? metric.gpu ?? ''}`
  const ensure = (metric) => {
    const key = keyOf(metric)
    if (!devices.has(key)) {
      devices.set(key, {
        pod: metric.pod || null,
        gpu: metric.gpu ?? null,
        uuid: metric.UUID ?? null,
        modelName: metric.modelName ?? null,
        utilization: [],
        memoryBytes: [],
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
