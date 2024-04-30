import { getKubernetesClient } from 'kitegg-directus-extension-common'
import k8s from '@kubernetes/client-node'
import { getDeploymentName } from './lib/util.js'
import { servicesNamespace } from './lib/config.js'

export async function getDeploymentInfo(user, deployment) {
  const statefulSetName = getDeploymentName(user, deployment.id)
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
      let { containerStatuses } = pod.status || {}
      containerStatuses = Array.isArray(containerStatuses)
        ? containerStatuses
        : []
      return {
        name: pod.metadata.name,
        phase: pod.status?.phase,
        containers: containerStatuses.map((container) => {
          return {
            name: container.name,
            ready: container.ready,
            started: container.started,
          }
        }),
      }
    }),
    volumes: (volumeClaims || []).map((vc) => {
      return {
        name: vc.metadata.name,
        phase: vc.status?.phase,
        capacity: vc.status?.capacity?.storage,
      }
    }),
  }
}
