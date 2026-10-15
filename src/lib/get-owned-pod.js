import { getKubernetesClient } from './get-kubernetes-client.js'
import { servicesNamespace } from './config.js'

// Fetches a pod by name and verifies that it belongs to the StatefulSet of
// the given deployment: StatefulSet pods are always named
// `<statefulSetName>-<ordinal>` and carry the `app: <statefulSetName>` label
// from the pod template, so listing pods with both a field selector on the
// name and the deployment's label selector can only return pods that were
// created by the deployment's StatefulSet. Returns undefined if no such pod
// exists, so pod scoped endpoints (logs, events, deletion) can reject pod
// names from other deployments instead of operating on them.
export async function getOwnedPod(statefulSetName, podName) {
  const coreClient = getKubernetesClient(servicesNamespace)
  const { body } = await coreClient.listNamespacedPod(
    servicesNamespace,
    undefined,
    undefined,
    undefined,
    `metadata.name=${podName}`,
    `app=${statefulSetName}`
  )
  return body.items[0]
}
