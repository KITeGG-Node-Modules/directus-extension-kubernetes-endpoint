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

const METRICS_API_GROUP = 'metrics.k8s.io'
const METRICS_API_VERSION = 'v1beta1'
const KUBELET_STATS_SUMMARY_PATH = 'stats/summary'

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
 * The kubelet's stats summary for one node, fetched through the API
 * server's node proxy (the same data `kubectl get --raw
 * /api/v1/nodes/<node>/proxy/stats/summary` returns). This is the only
 * source of actual volume usage (PVC bytes/inodes as seen by the kubelet).
 *
 * The generated client offers two ways to address the proxy subresource:
 * the `?path=` query form (NodeProxyOptions) and the `/proxy/{path}` URL
 * form, which the client percent-encodes — encoding the path segment
 * mangles `stats/summary` into `stats%2Fsummary` on the wire, so the
 * query form is used first and the URL form kept as a fallback.
 * Returns undefined when the summary cannot be fetched (missing
 * nodes/proxy RBAC, unreachable kubelet, ...) — volume stats then
 * degrade to empty without failing the endpoint.
 */
async function getKubeletStatsSummary(nodeName, coreClient) {
  const summaryCandidates = [
    () => coreClient.connectGetNodeProxy(nodeName, KUBELET_STATS_SUMMARY_PATH),
    () =>
      coreClient.connectGetNodeProxyWithPath(
        nodeName,
        KUBELET_STATS_SUMMARY_PATH
      ),
  ]
  let lastError
  for (const candidate of summaryCandidates) {
    try {
      const { body } = await candidate()
      return typeof body === 'string' ? JSON.parse(body) : body
    } catch (err) {
      if (
        isNotFound(err) ||
        err?.statusCode === 403 ||
        err?.body?.code === 403
      ) {
        // A missing node, an API-server RBAC denial or a kubelet
        // authorization failure will not go away by trying another call
        // shape — surface it to the caller instead of silently retrying
        throw err
      }
      lastError = err
    }
  }
  throw lastError
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
    const [utilization, profileUtilization, memory] = await Promise.all([
      prometheusQuery(prometheusUrl, '/api/v1/query', {
        query: queries.utilization,
      }),
      prometheusQuery(prometheusUrl, '/api/v1/query', {
        query: queries.profileUtilization,
      }),
      prometheusQuery(prometheusUrl, '/api/v1/query', {
        query: queries.memory,
      }),
    ])
    return {
      available: true,
      devices: collectGpuDevices(utilization, profileUtilization, memory),
    }
  } catch {
    return { available: false, devices: [] }
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
  const appsClient = getKubernetesClient(servicesNamespace, k8s.AppsV1Api)
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
  const { body: statefulSet } = await appsClient.readNamespacedStatefulSet(
    statefulSetName,
    servicesNamespace
  )
  const limitsByContainer = new Map(
    (statefulSet.spec?.template?.spec?.containers ?? [])
      .filter((container) => container.resources?.limits)
      .map((container) => [container.name, container.resources.limits])
  )

  const [{ metrics, available: metricsAvailable }, summaries, gpuUsage] =
    await Promise.all([
      getPodMetrics(statefulSetName),
      getKubeletSummaries(pods, coreClient),
      // DCGM instant queries: current utilization/framebuffer per GPU
      getGpuUsage(statefulSetPodSelector(statefulSetName, podName)),
    ])

  const result = {
    metricsAvailable,
    volumeStatsAvailable: summaries.available,
    gpuMetricsAvailable: gpuUsage.available,
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
            modelName: device.modelName,
            utilizationPercent: latestSample(device.utilization),
            memoryBytes: latestSample(device.memoryBytes),
          })),
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
      summary = await getKubeletStatsSummary(nodeName, coreClient)
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
