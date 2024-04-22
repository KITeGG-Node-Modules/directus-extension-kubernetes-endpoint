import { getKubernetesClient } from 'kitegg-directus-extension-common'
import k8s from '@kubernetes/client-node'
import { getDeploymentName } from './util.js'

export async function deleteDeployment(user, deployment) {
  const statefulSetName = getDeploymentName(user, deployment.id)
  const appsClient = getKubernetesClient('services', k8s.AppsV1Api)
  const coreClient = getKubernetesClient('services')
  const { body: podsBody } = await coreClient.listNamespacedPod(
    'services',
    undefined,
    undefined,
    undefined,
    undefined,
    `app=${statefulSetName}`
  )
  const { items: pods } = podsBody
  await appsClient.deleteNamespacedStatefulSet(
    statefulSetName,
    'services',
    undefined,
    undefined,
    undefined,
    undefined,
    'Background'
  )
  for (const pod of pods) {
    for (const containerStatus of pod.status.containerStatuses) {
      const serviceName = `${statefulSetName}-${containerStatus.name}`
      await coreClient.deleteNamespacedService(
        serviceName,
        'services',
        undefined,
        undefined,
        undefined,
        undefined,
        'Background'
      )
    }
  }
  const { body: volumeClaimsBody } =
    await coreClient.listNamespacedPersistentVolumeClaim(
      'services',
      undefined,
      undefined,
      undefined,
      undefined,
      `app=${statefulSetName}`
    )
  const { items: volumeClaims } = volumeClaimsBody
  for (const claim of volumeClaims) {
    await coreClient.deleteNamespacedPersistentVolumeClaim(
      claim.metadata.name,
      'services',
      undefined,
      undefined,
      undefined,
      undefined,
      'Background'
    )
  }
}
