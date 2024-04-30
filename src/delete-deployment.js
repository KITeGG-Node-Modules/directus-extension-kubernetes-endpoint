import { getKubernetesClient } from 'kitegg-directus-extension-common'
import k8s from '@kubernetes/client-node'
import { getDeploymentName } from './lib/util.js'
import { servicesNamespace } from './lib/config.js'

export async function deleteDeployment(user, deployment) {
  const statefulSetName = getDeploymentName(user, deployment.id)
  const appsClient = getKubernetesClient(servicesNamespace, k8s.AppsV1Api)
  const coreClient = getKubernetesClient(servicesNamespace)
  const { body: podsBody } = await coreClient.listNamespacedPod(
    servicesNamespace,
    undefined,
    undefined,
    undefined,
    undefined,
    `app=${statefulSetName}`
  )
  const { items: pods } = podsBody
  await appsClient.deleteNamespacedStatefulSet(
    statefulSetName,
    servicesNamespace,
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
        servicesNamespace,
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
      servicesNamespace,
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
      servicesNamespace,
      undefined,
      undefined,
      undefined,
      undefined,
      'Background'
    )
  }
}
