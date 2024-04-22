import { getKubernetesClient } from 'kitegg-directus-extension-common'
import k8s from '@kubernetes/client-node'

export async function getPodEvents(podName) {
  const eventsClient = getKubernetesClient('services', k8s.EventsV1Api)
  // const labelSelector = `statefulset.kubernetes.io/pod-name=${podName}`
  const fieldSelector = `regarding.name=${podName}`
  const { body } = await eventsClient.listNamespacedEvent(
    'services',
    undefined,
    undefined,
    undefined,
    fieldSelector,
    labelSelector
  )
  const { items } = body
  return (items || []).map((item) => {
    return {
      creationTimestamp: item.metadata.creationTimestamp,
      note: item.note,
      reason: item.reason,
      type: item.type,
    }
  })
}
