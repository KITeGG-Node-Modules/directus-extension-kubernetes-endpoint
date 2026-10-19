import { getKubernetesClient } from './lib/get-kubernetes-client.js'
import k8s from '@kubernetes/client-node'
import { getDeploymentName } from './lib/util.js'
import { servicesNamespace } from './lib/config.js'

/**
 * The part of a container's status the frontend needs to explain why a
 * container is not (yet) running. Kubernetes records pre-start failures
 * (runAsNonRoot, invalid config) durably in `state.waiting.reason` /
 * `.message` and crash loops in `lastState.terminated` — unlike events,
 * which expire (default 1h TTL) and are rate-limited, and unlike logs,
 * which do not exist for a container that never started.
 */
function containerStatus(container) {
  const waiting = container.state?.waiting
  const terminated = container.lastState?.terminated
  return {
    name: container.name,
    ready: container.ready,
    started: container.started,
    restartCount: container.restartCount ?? 0,
    waiting: waiting
      ? { reason: waiting.reason ?? null, message: waiting.message ?? null }
      : null,
    lastTermination: terminated
      ? {
          reason: terminated.reason ?? null,
          exitCode: terminated.exitCode ?? null,
        }
      : null,
  }
}

export async function getDeploymentInfo(deployment) {
  const statefulSetName = getDeploymentName(deployment.id)
  const appsClient = getKubernetesClient(servicesNamespace, k8s.AppsV1Api)
  const coreClient = getKubernetesClient(servicesNamespace)
  const { body: statefulSet } = await appsClient.readNamespacedStatefulSet(
    statefulSetName,
    servicesNamespace
  )
  const { body: podsBody } = await coreClient.listNamespacedPod(
    servicesNamespace,
    undefined,
    undefined,
    undefined,
    undefined,
    `app=${statefulSetName}`
  )
  const { items: pods } = podsBody
  const { body: volumeClaimsBody } =
    await coreClient.listNamespacedPersistentVolumeClaim(
      servicesNamespace,
      undefined,
      undefined,
      undefined,
      undefined,
      `app=${statefulSetName}`
    )
  const { items: volumeClaims } = volumeClaimsBody
  return {
    replicas: statefulSet.status.replicas,
    currentReplicas: statefulSet.status.currentReplicas,
    pods: (pods || []).map((pod) => {
      let { containerStatuses, initContainerStatuses } = pod.status || {}
      containerStatuses = Array.isArray(containerStatuses)
        ? containerStatuses
        : []
      initContainerStatuses = Array.isArray(initContainerStatuses)
        ? initContainerStatuses
        : []
      return {
        name: pod.metadata.name,
        phase: pod.status?.phase,
        containers: containerStatuses.map(containerStatus),
        initContainers: initContainerStatuses.map(containerStatus),
      }
    }),
    volumes: (volumeClaims || []).map((vc) => {
      return {
        name: vc.metadata.name,
        phase: vc.status?.phase,
        capacity: vc.status?.capacity?.storage,
        type: (vc.spec?.accessModes || []).find((e) =>
          e.startsWith('ReadWrite')
        ),
      }
    }),
  }
}
