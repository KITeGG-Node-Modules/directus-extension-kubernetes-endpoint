import { getKubernetesClient } from 'kitegg-directus-extension-common'
import k8s from '@kubernetes/client-node'
import { getDeploymentName } from './lib/util.js'
import { servicesNamespace } from './lib/config.js'
import { APP_LABEL_KEY } from './lib/constants.js'

function isNotFound(err) {
  return err?.statusCode === 404 || err?.body?.code === 404
}

/**
 * List resources carrying the deployment label and delete each one.
 * Already-deleted resources are ignored; other failures are collected.
 */
async function deleteLabeledResources(
  coreClient,
  listMethod,
  deleteMethod,
  labelSelector,
  errors
) {
  let items = []
  try {
    const response = await coreClient[listMethod](
      servicesNamespace,
      undefined,
      undefined,
      undefined,
      undefined,
      labelSelector
    )
    items = response.body.items
  } catch (err) {
    errors.push(err)
    return
  }
  for (const item of items) {
    try {
      await coreClient[deleteMethod](
        item.metadata.name,
        servicesNamespace,
        undefined,
        undefined,
        undefined,
        undefined,
        'Background'
      )
    } catch (err) {
      if (!isNotFound(err)) errors.push(err)
    }
  }
}

export async function deleteDeployment(user, deployment) {
  const statefulSetName = getDeploymentName(user, deployment.id)
  const appsClient = getKubernetesClient(servicesNamespace, k8s.AppsV1Api)
  const coreClient = getKubernetesClient(servicesNamespace)
  const labelSelector = `${APP_LABEL_KEY}=${statefulSetName}`
  const errors = []

  try {
    await appsClient.deleteNamespacedStatefulSet(
      statefulSetName,
      servicesNamespace,
      undefined,
      undefined,
      undefined,
      undefined,
      'Background'
    )
  } catch (err) {
    if (!isNotFound(err)) errors.push(err)
  }

  // Best-effort cleanup: continue even when individual resources fail,
  // then surface the first error so the request can be retried (every
  // step is idempotent). All created resources carry the deployment
  // label, including services of pods that never started, volume
  // claims, secrets and config maps.
  await deleteLabeledResources(
    coreClient,
    'listNamespacedService',
    'deleteNamespacedService',
    labelSelector,
    errors
  )
  await deleteLabeledResources(
    coreClient,
    'listNamespacedPersistentVolumeClaim',
    'deleteNamespacedPersistentVolumeClaim',
    labelSelector,
    errors
  )
  await deleteLabeledResources(
    coreClient,
    'listNamespacedSecret',
    'deleteNamespacedSecret',
    labelSelector,
    errors
  )
  await deleteLabeledResources(
    coreClient,
    'listNamespacedConfigMap',
    'deleteNamespacedConfigMap',
    labelSelector,
    errors
  )

  if (errors.length) throw errors[0]
}
