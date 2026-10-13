import { getKubernetesClient } from 'kitegg-directus-extension-common'
import k8s from '@kubernetes/client-node'
import { servicesNamespace } from '../lib/config.js'

/**
 * List the deployment ids that currently have at least one pod in the
 * Running phase.
 *
 * Powers the client-side "running" filter on the services overview: run
 * state lives in the cluster, not in Directus, so it cannot be expressed
 * as a Directus field filter. One statefulset + one pod list call covers
 * the whole namespace.
 */
export async function getDeploymentsState() {
  const appsClient = getKubernetesClient(servicesNamespace, k8s.AppsV1Api)
  const coreClient = getKubernetesClient(servicesNamespace)

  const { body: statefulSetsBody } =
    await appsClient.listNamespacedStatefulSet(servicesNamespace)
  const { body: podsBody } =
    await coreClient.listNamespacedPod(servicesNamespace)

  // pods carry the app=<statefulset name> label (see get-deployment-info)
  const hasRunningPod = new Set()
  for (const pod of podsBody.items) {
    const app = pod.metadata?.labels?.app
    if (app && pod.status?.phase === 'Running') {
      hasRunningPod.add(app)
    }
  }

  // getDeploymentName maps `sd-<slug>`; the slug is the deployment id
  const running = statefulSetsBody.items
    .map((item) => item.metadata?.name)
    .filter((name) => name?.startsWith('sd-') && hasRunningPod.has(name))
    .map((name) => name.slice('sd-'.length))

  return { running }
}
