import { getKubernetesClient } from 'kitegg-directus-extension-common'
import k8s from '@kubernetes/client-node'
import { servicesNamespace } from './lib/config.js'

export async function getPodEvents(podName) {
  const eventsClient = getKubernetesClient(servicesNamespace, k8s.EventsV1Api)
  // const labelSelector = `statefulset.kubernetes.io/pod-name=${podName}`
  const fieldSelector = `regarding.name=${podName}`
  const { body } = await eventsClient.listNamespacedEvent(
    servicesNamespace,
    undefined,
    undefined,
    undefined,
    fieldSelector
    // labelSelector
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
