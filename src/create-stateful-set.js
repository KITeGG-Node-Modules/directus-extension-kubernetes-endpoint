import { getKubernetesClient } from './lib/get-kubernetes-client.js'
import k8s from '@kubernetes/client-node'
import { servicesNamespace } from './lib/config.js'
import { upsert } from './lib/upsert.js'
import { labelExistingVolumeClaims } from './lib/label-volume-claims.js'

export async function createStatefulSet(statefulSet, statefulSetName) {
  const client = getKubernetesClient(servicesNamespace, k8s.AppsV1Api)

  function replaceStatefulSet(payload) {
    return client.replaceNamespacedStatefulSet(
      statefulSetName,
      servicesNamespace,
      payload
    )
  }

  /**
   * The stored volume claim templates, or null when they cannot be
   * determined (the upsert read raced a concurrent create and lost, or
   * the re-read failed).
   */
  async function resolveStoredTemplates(current) {
    if (current?.body) {
      return current.body.spec?.volumeClaimTemplates ?? []
    }
    const existing = await client
      .readNamespacedStatefulSet(statefulSetName, servicesNamespace)
      .catch(() => null)
    if (existing?.body) {
      return existing.body.spec?.volumeClaimTemplates ?? []
    }
    return null
  }

  return upsert({
    read: () =>
      client.readNamespacedStatefulSet(statefulSetName, servicesNamespace),
    create: () =>
      client.createNamespacedStatefulSet(servicesNamespace, statefulSet),
    update: async (current) => {
      const storedTemplates = await resolveStoredTemplates(current)
      if (!storedTemplates) {
        // The stored templates are unknown: replace with the payload as-is
        // and let the API server validate it
        return replaceStatefulSet(statefulSet)
      }
      const payloadTemplates = statefulSet.spec?.volumeClaimTemplates ?? []
      const added = payloadTemplates.filter(
        (template) =>
          !storedTemplates.some(
            (storedTemplate) =>
              storedTemplate.metadata?.name === template.metadata?.name
          )
      )
      if (added.length) {
        const names = added
          .map((template) => `'${template.metadata?.name}'`)
          .join(', ')
        const error = new Error(
          `Cannot add volume claim templates ${names}: volume claim templates are immutable on an existing deployment. Delete the deployment and deploy it again to change its volumes (its volume claims and data are deleted)`
        )
        error.statusCode = 400
        error.extensions = { code: 'INVALID_PAYLOAD' }
        throw error
      }
      // Volume claim templates are immutable on an existing StatefulSet:
      // replacing it with the payload's templates (which carry labels the
      // stored ones may not have) is rejected with "field is immutable".
      // Keep the stored templates exactly as they are.
      await replaceStatefulSet({
        ...statefulSet,
        spec: {
          ...statefulSet.spec,
          volumeClaimTemplates: storedTemplates,
        },
      })
      // The stored templates may predate the deployment label, so their
      // claims do not match the label selector used by the status and
      // delete endpoints: label the claims in place
      if (storedTemplates.length) {
        await labelExistingVolumeClaims(statefulSetName)
      }
    },
  })
}
