import { getDeploymentName, statefulSetPodSelector } from './lib/util.js'
import { prometheusUrl, servicesNamespace } from './lib/config.js'
import { prometheusQuery } from './lib/prometheus.js'
import { collectGpuDevices, gpuDeviceQueries } from './lib/gpu-metrics.js'

// Durations ("30s", "5m", "1h", "7d") — the single-unit subset of the
// Prometheus duration syntax, enough for range/step parameters
const DURATION_PATTERN = /^(\d+)(s|m|h|d)$/
const UNIT_SECONDS = { s: 1, m: 60, h: 3600, d: 86400 }

// History windows are bounded by the Prometheus retention anyway; the cap
// only stops single queries from turning into unbounded work
const MAX_RANGE_SECONDS = 30 * UNIT_SECONDS.d
const MIN_STEP_SECONDS = 15
const MAX_STEP_SECONDS = 900
const MIN_RATE_WINDOW_SECONDS = 240

/**
 * Parse a single-unit Prometheus duration ("45s", "10m", "6h", "7d")
 * into seconds, or null when it is not a valid duration.
 */
export function parseDuration(value) {
  const match = typeof value === 'string' && value.match(DURATION_PATTERN)
  if (!match) return null
  return parseInt(match[1], 10) * UNIT_SECONDS[match[2]]
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function invalidParameter(message) {
  const error = new Error(message)
  error.statusCode = 400
  error.extensions = { code: 'INVALID_PAYLOAD' }
  return error
}

/**
 * Turn a matrix result into { labelValue: [[ts, value], ...] } with the
 * Prometheus sample values parsed to numbers.
 */
function seriesByLabel(result, label) {
  const series = new Map()
  for (const entry of result) {
    const key = entry.metric?.[label] ?? ''
    series.set(
      key,
      (entry.values ?? []).map(([timestamp, value]) => [
        Number(timestamp),
        Number(value),
      ])
    )
  }
  return series
}

/**
 * Time series for a deployment's container resource usage and volume
 * usage, queried from the Prometheus instance that scrapes the services
 * namespace (the same metrics the stats endpoint samples point-in-time):
 *
 * - CPU cores per container: rate of container_cpu_usage_seconds_total
 *   (exactly what kubectl top / the metrics-server derive their samples
 *   from)
 * - memory working set per container: container_memory_working_set_bytes
 *   (the metric the OOM killer and the metrics-server are based on)
 * - volume usage per claim: kubelet_volume_stats_used_bytes /
 *   kubelet_volume_stats_capacity_bytes
 *
 * Series are aggregated by container name across the deployment's
 * replicas (sum), so a series survives pod restarts and re-scheduling;
 * single-pod deployments can scope queries with ?pod=<pod name>.
 *
 * Like the stats endpoint, history degrades instead of failing: without
 * a configured Prometheus (`PROMETHEUS_URL=''`) or on query errors the
 * response is { available: false } with the reason — clients keep
 * working, just without charts.
 */
export async function getDeploymentStatsHistory(
  deployment,
  { rangeSeconds, stepSeconds = null, podName = null } = {}
) {
  if (!prometheusUrl) {
    return { available: false, reason: 'prometheus_not_configured' }
  }
  if (
    rangeSeconds == null ||
    rangeSeconds <= 0 ||
    rangeSeconds > MAX_RANGE_SECONDS
  ) {
    throw invalidParameter(
      `range must be a duration of 1s to ${MAX_RANGE_SECONDS}s (e.g. '1h')`
    )
  }
  if (
    stepSeconds != null &&
    (stepSeconds < MIN_STEP_SECONDS || stepSeconds > MAX_STEP_SECONDS)
  ) {
    throw invalidParameter(
      `step must be a duration of ${MIN_STEP_SECONDS}s to ${MAX_STEP_SECONDS}s`
    )
  }
  const step =
    stepSeconds ??
    Math.min(
      MAX_STEP_SECONDS,
      Math.max(MIN_STEP_SECONDS, Math.round(rangeSeconds / 150))
    )

  const statefulSetName = getDeploymentName(deployment.id)
  const end = Math.floor(Date.now() / 1000)
  const start = end - rangeSeconds
  const rateWindow = Math.max(step, MIN_RATE_WINDOW_SECONDS)

  // StatefulSet pods are named <statefulSetName>-<ordinal>; a requested
  // pod name pins the queries to that pod, otherwise the whole set
  const podSelector = statefulSetPodSelector(statefulSetName, podName)

  // Volume claim templates produce claims named
  // <template-name>-<statefulSetName>-<ordinal> (see isVolumeClaimOf)
  const claimSelector = `^.*-${escapeRegex(statefulSetName)}-\\d+$`

  const podLabels = `namespace="${servicesNamespace}",pod=~"${podSelector}"`
  // container="POD" rows are the pause containers cAdvisor reports per
  // pod — not a user container's usage
  const containerSelector = `${podLabels},container!="",container!="POD"`

  const queries = {
    cpu: `sum by (container) (rate(container_cpu_usage_seconds_total{${containerSelector}}[${rateWindow}s]))`,
    memory: `sum by (container) (container_memory_working_set_bytes{${containerSelector}})`,
    volumeUsed: `max by (persistentvolumeclaim) (kubelet_volume_stats_used_bytes{namespace="${servicesNamespace}",persistentvolumeclaim=~"${claimSelector}"})`,
    volumeCapacity: `max by (persistentvolumeclaim) (kubelet_volume_stats_capacity_bytes{namespace="${servicesNamespace}",persistentvolumeclaim=~"${claimSelector}"})`,
    // GPU utilization is invisible to the metrics-server/cAdvisor —
    // DCGM is the only source (see lib/gpu-metrics.js)
    ...Object.fromEntries(
      Object.entries(gpuDeviceQueries(podSelector)).map(([name, query]) => [
        `gpu${name[0].toUpperCase()}${name.slice(1)}`,
        query,
      ])
    ),
  }

  const warnings = []
  const results = {}
  for (const [name, query] of Object.entries(queries)) {
    try {
      results[name] = await prometheusQuery(
        prometheusUrl,
        '/api/v1/query_range',
        { query, start: String(start), end: String(end), step: `${step}s` }
      )
    } catch (err) {
      warnings.push(`${name} query failed: ${err?.message ?? err}`)
      results[name] = []
    }
  }
  if (warnings.length === Object.keys(queries).length) {
    return {
      available: false,
      reason: 'prometheus_unavailable',
      warnings,
    }
  }

  const cpu = seriesByLabel(results.cpu, 'container')
  const memory = seriesByLabel(results.memory, 'container')
  const containerNames = [...new Set([...cpu.keys(), ...memory.keys()])].sort()
  const volumeUsed = seriesByLabel(results.volumeUsed, 'persistentvolumeclaim')
  const volumeCapacity = seriesByLabel(
    results.volumeCapacity,
    'persistentvolumeclaim'
  )
  const claimNames = [
    ...new Set([...volumeUsed.keys(), ...volumeCapacity.keys()]),
  ].sort()

  const gpuDevices = collectGpuDevices(
    results.gpuUtilization,
    results.gpuProfileUtilization,
    results.gpuMemory
  )

  const history = {
    available: true,
    rangeSeconds,
    stepSeconds: step,
    start,
    end,
    gpuMetricsAvailable:
      results.gpuUtilization.length > 0 ||
      results.gpuProfileUtilization.length > 0,
    containers: containerNames.map((name) => ({
      name,
      cpuCores: cpu.get(name) ?? [],
      memoryBytes: memory.get(name) ?? [],
    })),
    volumes: claimNames.map((name) => ({
      name,
      usedBytes: volumeUsed.get(name) ?? [],
      capacityBytes: volumeCapacity.get(name) ?? [],
    })),
    gpus: gpuDevices.map((device) => ({
      pod: device.pod,
      gpu: device.gpu,
      uuid: device.uuid,
      modelName: device.modelName,
      utilizationPercent: device.utilization,
      memoryBytes: device.memoryBytes,
    })),
  }
  if (warnings.length) {
    history.warnings = warnings
  }
  return history
}
