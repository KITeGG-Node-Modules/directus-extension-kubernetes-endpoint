// SPDX-License-Identifier: EUPL-1.2
import { getKubernetesClient } from './get-kubernetes-client.js'
import k8s from '@kubernetes/client-node'
import { servicesNamespace } from './config.js'
import { isNotFound } from './is-not-found.js'

/**
 * Resource limits of the StatefulSet's pod-template containers, keyed by
 * container name — the ceilings the containers were deployed with (the
 * deployment YAML's cpu/memory/gpu values after normalization). Usage
 * from the metrics API and Prometheus is measured against these.
 *
 * With allowNotFound (history endpoint), a missing StatefulSet yields an
 * empty map instead of a 404 — there is nothing to ceiling. The stats
 * endpoint keeps propagating the 404 so an undeployed deployment stays
 * a 404, consistent with the deployment status endpoint.
 */
export async function getContainerLimits(
  statefulSetName,
  { allowNotFound = false } = {}
) {
  const appsClient = getKubernetesClient(servicesNamespace, k8s.AppsV1Api)
  try {
    const { body: statefulSet } = await appsClient.readNamespacedStatefulSet(
      statefulSetName,
      servicesNamespace
    )
    return new Map(
      (statefulSet.spec?.template?.spec?.containers ?? [])
        .filter((container) => container.resources?.limits)
        .map((container) => [container.name, container.resources.limits])
    )
  } catch (err) {
    if (allowNotFound && isNotFound(err)) {
      return new Map()
    }
    throw err
  }
}
