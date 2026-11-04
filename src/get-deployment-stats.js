import { getKubernetesClient } from './lib/get-kubernetes-client.js'
import k8s from '@kubernetes/client-node'
import { prometheusUrl, servicesNamespace } from './lib/config.js'
import { getDeploymentName, statefulSetPodSelector } from './lib/util.js'
import { isNotFound } from './lib/is-not-found.js'
import { parseQuantity } from './lib/quantity.js'
import { prometheusQuery } from './lib/prometheus.js'
import {
  collectGpuDevices,
  gpuDeviceQueries,
  latestSample,
} from './lib/gpu-metrics.js'
import {
  collectNetworkSeries,
  networkCurrentQueries,
} from './lib/network-metrics.js'
import { GPU_RESOURCE_NAMES } from './lib/gpu-profiles.js'
import { getContainerLimits } from './lib/container-limits.js'
import { getKubeletStatsSummary } from './lib/kubelet-summary.js'

const METRICS_API_GROUP = 'metrics.k8s.io'
const METRICS_API_VERSION = 'v1beta1'

/**
 * Container resource usage in both of the forms clients need: the raw
 * Kubernetes quantity strings as kubectl top (and this response) show
 * them, plus the parsed base values (cores / bytes) for display math.
 * Usage may be missing when the pod had no metrics sample yet.
 */
function parseUsage(usage) {
  if (!usage) return null
  const cpuCores = parseQuantity(usage.cpu)
  const memoryBytes = parseQuantity(usage.memory)
  return {
    cpu: usage.cpu ?? null,
    cpuCores: cpuCores ?? null,
    memory: usage.memory ?? null,
    memoryBytes: memoryBytes ?? null,
  }
}

function sumUsage(entries) {
  let cpuCores = null
  let memoryBytes = null
  for (const entry of entries) {
    if (entry?.cpuCores != null) {
      cpuCores = (cpuCores ?? 0) + entry.cpuCores
    }
    if (entry?.memoryBytes != null) {
      memoryBytes = (memoryBytes ?? 0) + entry.memoryBytes
    }
  }
  return { cpuCores, memoryBytes }
}

/**
 * Metrics-server PodMetrics for the deployment's pods, keyed by pod name.
 * Returns { metrics: Map, available: false } when the metrics API is not
 * reachable at all (no metrics-server installed) — resource usage then
 * degrades to null while volume stats stay unaffected.
 */
async function getPodMetrics(statefulSetName) {
  const customClient = getKubernetesClient(
    servicesNamespace,
    k8s.CustomObjectsApi
  )
  try {
    const { body } = await customClient.listNamespacedCustomObject(
      METRICS_API_GROUP,
      METRICS_API_VERSION,
      servicesNamespace,
      'pods',
      undefined,
      undefined,
      undefined,
      undefined,
      `app=${statefulSetName}`
    )
    const items = body?.items ?? []
    const metrics = new Map(
      items.map((metric) => [metric.metadata?.name, metric])
    )
    return { metrics, available: true }
  } catch (err) {
    if (isNotFound(err)) {
      // Either the deployment has no pods yet or the metrics API
      // (metrics-server) is not installed at all — both mean "no data"
      return { metrics: new Map(), available: false }
    }
    throw err
  }
}

/**
 * Volume statistics for one pod from the kubelet stats summary, joined
 * with the pod spec's volume mounts so clients can relate usage to the
 * mount paths of the deployment YAML. Only volumes the kubelet actually
 * reports storage for (PVCs and volume-backed ephemeral storage) are
 * listed; configmap/secret projections carry no meaningful byte counts.
 */
function volumeStats(pod, summaryPodEntry) {
  const mountPathsByVolume = new Map()
  for (const container of pod.spec?.containers ?? []) {
    for (const mount of container.volumeMounts ?? []) {
      if (!mountPathsByVolume.has(mount.name)) {
        mountPathsByVolume.set(mount.name, [])
      }
      mountPathsByVolume.get(mount.name).push(mount.mountPath)
    }
  }
  return (summaryPodEntry?.volume ?? [])
    .map((volume) => {
      const claimName = volume.pvcRef?.name ?? null
      return {
        // The kubelet reports pod-spec volume names; for StatefulSet
        // volume claim templates these equal the claim name
        name: volume.name ?? null,
        claimName,
        mountPaths: mountPathsByVolume.get(volume.name) ?? [],
        usedBytes: volume.usedBytes ?? null,
        capacityBytes: volume.capacityBytes ?? null,
        availableBytes: volume.availableBytes ?? null,
        inodesUsed: volume.inodesUsed ?? null,
        inodesTotal: volume.inodes ?? null,
        time: volume.time ?? null,
      }
    })
    .filter(
      (volume) =>
        volume.usedBytes != null ||
        volume.capacityBytes != null ||
        volume.claimName != null
    )
}

/**
 * Current GPU usage for the deployment's pods, from dcgm-exporter
 * metrics via a Prometheus instant query (GPU utilization is invisible
 * to the metrics-server — DCGM is the only source). Devices are
 * attributed to pods via the exporter's `pod` label; without that
 * mapping (or without dcgm-exporter, or on any Prometheus error) the
 * result is empty and gpuMetricsAvailable is false. Degrades silently:
 * GPU-less deployments are the normal empty case.
 */
async function getGpuUsage(podSelector) {
  if (!prometheusUrl) {
    return { available: false, devices: [] }
  }
  const queries = gpuDeviceQueries(podSelector)
  try {
    const [utilization, profileUtilization, memory, memoryFree] =
      await Promise.all([
        prometheusQuery(prometheusUrl, '/api/v1/query', {
          query: queries.utilization,
        }),
        prometheusQuery(prometheusUrl, '/api/v1/query', {
          query: queries.profileUtilization,
        }),
        prometheusQuery(prometheusUrl, '/api/v1/query', {
          query: queries.memory,
        }),
        prometheusQuery(prometheusUrl, '/api/v1/query', {
          query: queries.memoryFree,
        }),
      ])
    return {
      available: true,
      devices: collectGpuDevices(
        utilization,
        profileUtilization,
        memory,
        memoryFree
      ),
    }
  } catch {
    return { available: false, devices: [] }
  }
}

/**
 * Current network I/O for the deployment's pods, from cAdvisor metrics
 * via Prometheus instant queries (the kubelet stats summary carries no
 * network counters). Rates are computed over a 5m window, totals are the
 * cumulative counters. Degrades silently like the GPU part: without
 * reachable Prometheus or scrape data the result is empty.
 */
async function getNetworkUsage(podSelector) {
  if (!prometheusUrl) {
    return { available: false, rates: [], totals: [] }
  }
  const queries = networkCurrentQueries(podSelector)
  try {
    const [receiveRate, transmitRate, receiveTotal, transmitTotal] =
      await Promise.all([
        prometheusQuery(prometheusUrl, '/api/v1/query', {
          query: queries.receiveRate,
        }),
        prometheusQuery(prometheusUrl, '/api/v1/query', {
          query: queries.transmitRate,
        }),
        prometheusQuery(prometheusUrl, '/api/v1/query', {
          query: queries.receiveTotal,
        }),
        prometheusQuery(prometheusUrl, '/api/v1/query', {
          query: queries.transmitTotal,
        }),
      ])
    return {
      available: true,
      rates: collectNetworkSeries(receiveRate, transmitRate),
      totals: collectNetworkSeries(receiveTotal, transmitTotal),
    }
  } catch {
    return { available: false, rates: [], totals: [] }
  }
}

/**
 * The GPU resources a pod was allocated, from the live pod spec's
 * container limits (requests equal limits for extended resources):
 * [{ resource: 'nvidia.com/mig-1g.10gb', count: 1 }, ...]. This is the
 * deployment's own grant — visible even when DCGM has no data, and the
 * counterpart the per-device migProfile/capacityBytes are measured
 * against.
 */
function gpuAllocation(pod) {
  const counts = new Map()
  for (const container of pod.spec?.containers ?? []) {
    for (const [resource, value] of Object.entries(
      container.resources?.limits ?? {}
    )) {
      if (GPU_RESOURCE_NAMES.includes(resource)) {
        const count = Number(value)
        if (Number.isFinite(count) && count > 0) {
          counts.set(resource, (counts.get(resource) ?? 0) + count)
        }
      }
    }
  }
  return [...counts.entries()].map(([resource, count]) => ({
    resource,
    count,
  }))
}

/**
 * Merge the rate and total series for one pod into the response's
 * `network` block (nulls when Prometheus had no data for the pod).
 */
function networkForPod(networkUsage, podName) {
  const rates = networkUsage.rates.find((n) => n.pod === podName)
  const totals = networkUsage.totals.find((n) => n.pod === podName)
  return {
    receiveBytesPerSecond: latestSample(rates?.receive ?? []),
    transmitBytesPerSecond: latestSample(rates?.transmit ?? []),
    receiveBytesTotal: latestSample(totals?.receive ?? []),
    transmitBytesTotal: latestSample(totals?.transmit ?? []),
  }
}

/**
 * Current runtime statistics for a deployment's containers:
 *
 * - resource usage per container and pod, from the metrics-server API
 *   (metrics.k8s.io — the source of `kubectl top` / kubetop results),
 *   alongside the resource limits the containers were deployed with
 * - volume usage per pod (PVC used/capacity/inodes as seen by the
 *   kubelet), from the kubelet stats summary via the node proxy
 *
 * Both sources degrade independently: without metrics-server the usage
 * fields are null and `metricsAvailable` is false, without working
 * node-proxy/kubelet access `volumeStatsAvailable` is false — the
 * endpoint still returns whatever it could collect.
 */
export async function getDeploymentStats(deployment, podName = null) {
  const statefulSetName = getDeploymentName(deployment.id)
  const coreClient = getKubernetesClient(servicesNamespace)

  const fieldSelector = podName ? `metadata.name=${podName}` : undefined
  const { body: podsBody } = await coreClient.listNamespacedPod(
    servicesNamespace,
    undefined,
    undefined,
    undefined,
    fieldSelector,
    `app=${statefulSetName}`
  )
  const pods = podsBody.items ?? []

  if (podName && pods.length === 0) {
    return null
  }

  // Limits come from the StatefulSet pod template — the containers as
  // deployed (the deployment YAML's cpu/memory values after normalization)
  const limitsByContainer = await getContainerLimits(statefulSetName)

  const [
    { metrics, available: metricsAvailable },
    summaries,
    gpuUsage,
    networkUsage,
  ] = await Promise.all([
    getPodMetrics(statefulSetName),
    getKubeletSummaries(pods, coreClient),
    // DCGM instant queries: current utilization/framebuffer per GPU
    getGpuUsage(statefulSetPodSelector(statefulSetName, podName)),
    // cAdvisor instant queries: current network I/O per pod
    getNetworkUsage(statefulSetPodSelector(statefulSetName, podName)),
  ])

  const result = {
    metricsAvailable,
    volumeStatsAvailable: summaries.available,
    gpuMetricsAvailable: gpuUsage.available,
    networkMetricsAvailable: networkUsage.available,
    pods: pods.map((pod) => {
      const podMetric = metrics.get(pod.metadata.name)
      const summaryPodEntry = summaries.byPod.get(pod.metadata.name)

      const containers = (podMetric?.containers ?? []).map((metric) => {
        const usage = parseUsage(metric.usage)
        return {
          name: metric.name,
          usage,
          limits: limitsByContainer.get(metric.name) ?? null,
        }
      })
      const podUsage = sumUsage(containers.map((c) => c.usage))

      return {
        name: pod.metadata.name,
        phase: pod.status?.phase ?? null,
        node: pod.spec?.nodeName ?? null,
        usage: {
          cpuCores: podUsage.cpuCores,
          memoryBytes: podUsage.memoryBytes,
          timestamp: podMetric?.timestamp ?? null,
          window: podMetric?.window ?? null,
        },
        containers,
        volumes: volumeStats(pod, summaryPodEntry),
        gpus: gpuUsage.devices
          .filter((device) => device.pod === pod.metadata.name)
          .map((device) => ({
            gpu: device.gpu,
            uuid: device.uuid,
            gpuInstanceId: device.gpuInstanceId,
            migProfile: device.migProfile,
            modelName: device.modelName,
            utilizationPercent: latestSample(device.utilization),
            memoryBytes: latestSample(device.memoryBytes),
            capacityBytes: latestSample(device.capacityBytes),
          })),
        gpuAllocation: gpuAllocation(pod),
        network: networkForPod(networkUsage, pod.metadata.name),
      }
    }),
  }
  if (summaries.warnings.length) {
    result.warnings = summaries.warnings
  }
  return result
}

/**
 * Fetch the kubelet stats summary for every node the deployment's pods
 * run on (deduplicated), returning the summaries keyed by pod name.
 * Unreachable summaries degrade to an empty volume list plus a warning;
 * authorization failures (missing nodes/proxy RBAC) are reported through
 * the same warning channel without failing the whole endpoint.
 */
async function getKubeletSummaries(pods, coreClient) {
  const byPod = new Map()
  const warnings = []
  const nodes = [
    ...new Set(pods.map((pod) => pod.spec?.nodeName).filter(Boolean)),
  ]

  let available = nodes.length > 0
  for (const nodeName of nodes) {
    let summary
    try {
      summary = await getKubeletStatsSummary(coreClient, nodeName)
    } catch (err) {
      available = false
      warnings.push(
        `volume stats for node ${nodeName} unavailable: ${
          err?.body?.message ?? err?.message ?? 'unknown error'
        }`
      )
      continue
    }
    available = available && Boolean(summary)
    for (const summaryPod of summary?.pods ?? []) {
      if (summaryPod.podRef?.name) {
        byPod.set(summaryPod.podRef.name, summaryPod)
      }
    }
  }
  return { byPod, available, warnings }
}
