import { getKubernetesClient } from './lib/get-kubernetes-client.js'
import { servicesNamespace } from './lib/config.js'

function isPodReady(pod) {
  return Boolean(
    pod?.status?.conditions?.some(
      (condition) => condition.type === 'Ready' && condition.status === 'True'
    )
  )
}

/**
 * Deletes every pod of the deployment's StatefulSet that never became
 * Ready, and returns the deleted pod names.
 *
 * The StatefulSet controller's OrderedReady rolling update records a new
 * revision for an updated pod template but never rolls a pod that is not
 * Ready (stuck in CreateContainerConfigError, CrashLoopBackOff or Pending):
 * the pod keeps running the old template forever, so re-deploying a failing
 * deployment silently kept its broken configuration and looked like a
 * no-op. Deleting the pod makes the controller recreate it from the current
 * template immediately. Ready pods are left alone so a healthy deployment's
 * re-deploy keeps using the controller's graceful rolling update.
 */
export async function deleteUnreadyStatefulSetPods(statefulSetName) {
  const coreClient = getKubernetesClient(servicesNamespace)
  const { body } = await coreClient.listNamespacedPod(
    servicesNamespace,
    undefined,
    undefined,
    undefined,
    undefined,
    `app=${statefulSetName}`
  )
  const deleted = []
  for (const pod of body.items) {
    if (pod.metadata?.deletionTimestamp || isPodReady(pod)) {
      continue
    }
    await coreClient.deleteNamespacedPod(pod.metadata.name, servicesNamespace)
    deleted.push(pod.metadata.name)
  }
  return deleted
}
