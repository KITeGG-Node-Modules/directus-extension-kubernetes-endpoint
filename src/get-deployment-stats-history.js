import { getDeploymentName, statefulSetPodSelector } from './lib/util.js'
import { prometheusUrl, servicesNamespace } from './lib/config.js'
import { prometheusQuery, promqlString } from './lib/prometheus.js'
import { collectGpuDevices, gpuDeviceQueries } from './lib/gpu-metrics.js'
import {
  collectNetworkSeries,
  networkRateQueries,
} from './lib/network-metrics.js'
import { getContainerLimits } from './lib/container-limits.js'

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
  return seriesByLabels(result, [label])
}

/**
 * Like seriesByLabel, but keyed by the joined values of several labels —
 * used for the per-(container, pod) container series.
 */
function seriesByLabels(result, labels) {
  const series = new Map()
  for (const entry of result) {
    const key = labels.map((label) => entry.metric?.[label] ?? '').join('|')
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
 * - CPU cores per container and pod: rate of
 *   container_cpu_usage_seconds_total (exactly what kubectl top / the
 *   metrics-server derive their samples from)
 * - memory working set per container and pod:
 *   container_memory_working_set_bytes (the metric the OOM killer and
 *   the metrics-server are based on)
 * - volume usage per claim: kubelet_volume_stats_used_bytes /
 *   kubelet_volume_stats_capacity_bytes
 *
 * Container series are aggregated per container name AND replica pod —
 * a multi-container pod shows one series per container, a multi-replica
 * deployment one series per replica, so the charts always show where
 * the usage comes from. The trade-off: a series ends when its pod is
 * re-scheduled (the new pod starts a fresh one). Single-pod
 * deployments can further scope queries with ?pod=<pod name>.
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

  // The containers' deployed ceilings (cpu/memory/... limits), so
  // clients can show usage against the granted capacity. A missing
  // StatefulSet means there is nothing to ceiling (empty map) — the
  // Prometheus queries already return empty series in that case.
  const limitsByContainer = await getContainerLimits(statefulSetName, {
    allowNotFound: true,
  })

  // StatefulSet pods are named <statefulSetName>-<ordinal>; a requested
  // pod name pins the queries to that pod, otherwise the whole set
  const podSelector = statefulSetPodSelector(statefulSetName, podName)

  // Volume claim templates produce claims named
  // <template-name>-<statefulSetName>-<ordinal> (see isVolumeClaimOf)
  const claimSelector = `^.*-${escapeRegex(statefulSetName)}-\\d+$`

  // The regex selectors go into PromQL string literals, where a single
  // backslash (\d) is an unknown escape sequence — promqlString doubles
  // them (see lib/prometheus.js)
  const podLabels = `namespace="${servicesNamespace}",pod=~${promqlString(podSelector)}`
  // container="POD" rows are the pause containers cAdvisor reports per
  // pod — not a user container's usage
  const containerSelector = `${podLabels},container!="",container!="POD"`

  const queries = {
    // Per container AND pod: replicas stay separate lines instead of
    // merging into one sum
    cpu: `sum by (container, pod) (rate(container_cpu_usage_seconds_total{${containerSelector}}[${rateWindow}s]))`,
    memory: `sum by (container, pod) (container_memory_working_set_bytes{${containerSelector}})`,
    volumeUsed: `max by (persistentvolumeclaim) (kubelet_volume_stats_used_bytes{namespace="${servicesNamespace}",persistentvolumeclaim=~${promqlString(claimSelector)}})`,
    volumeCapacity: `max by (persistentvolumeclaim) (kubelet_volume_stats_capacity_bytes{namespace="${servicesNamespace}",persistentvolumeclaim=~${promqlString(claimSelector)}})`,
    // GPU utilization is invisible to the metrics-server/cAdvisor —
    // DCGM is the only source (see lib/gpu-metrics.js)
    ...Object.fromEntries(
      Object.entries(gpuDeviceQueries(podSelector)).map(([name, query]) => [
        `gpu${name[0].toUpperCase()}${name.slice(1)}`,
        query,
      ])
    ),
    // Pod network I/O per pod (cAdvisor); rates need the same window
    // treatment as the CPU rate above
    ...Object.fromEntries(
      Object.entries(networkRateQueries(podSelector, rateWindow)).map(
        ([name, query]) => [
          `network${name[0].toUpperCase()}${name.slice(1)}`,
          query,
        ]
      )
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

  const cpu = seriesByLabels(results.cpu, ['container', 'pod'])
  const memory = seriesByLabels(results.memory, ['container', 'pod'])
  const containerKeys = [...new Set([...cpu.keys(), ...memory.keys()])].sort()
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
    results.gpuMemory,
    results.gpuMemoryFree
  )
  const networkSeries = collectNetworkSeries(
    results.networkReceiveRate,
    results.networkTransmitRate
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
    networkMetricsAvailable:
      results.networkReceiveRate.length > 0 ||
      results.networkTransmitRate.length > 0,
    containers: containerKeys.map((key) => {
      // container and pod names are DNS labels — '|' never occurs in a key
      const separator = key.indexOf('|')
      const name = key.slice(0, separator)
      const pod = key.slice(separator + 1)
      return {
        name,
        pod,
        cpuCores: cpu.get(key) ?? [],
        memoryBytes: memory.get(key) ?? [],
        // the deployed ceiling for this container (identical across
        // replicas — they share the StatefulSet pod template)
        limits: limitsByContainer.get(name) ?? null,
      }
    }),
    volumes: claimNames.map((name) => ({
      name,
      usedBytes: volumeUsed.get(name) ?? [],
      capacityBytes: volumeCapacity.get(name) ?? [],
    })),
    gpus: gpuDevices.map((device) => ({
      pod: device.pod,
      gpu: device.gpu,
      uuid: device.uuid,
      gpuInstanceId: device.gpuInstanceId,
      migProfile: device.migProfile,
      modelName: device.modelName,
      utilizationPercent: device.utilization,
      memoryBytes: device.memoryBytes,
      capacityBytes: device.capacityBytes,
    })),
    networks: networkSeries.map((entry) => ({
      pod: entry.pod,
      receiveBytesPerSecond: entry.receive,
      transmitBytesPerSecond: entry.transmit,
    })),
  }
  if (warnings.length) {
    history.warnings = warnings
  }
  return history
}
