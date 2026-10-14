import k8s from '@kubernetes/client-node'
import { getKubernetesClient } from './get-kubernetes-client.js'
import { servicesNamespace } from './config.js'
import { APP_LABEL_KEY } from './constants.js'
import { isVolumeClaimOf } from './util.js'

// PATCH requests are rejected with 415 unless the Content-Type names a
// patch format; the generated client does not set it on its own
const mergePatch = {
  headers: {
    'Content-type': k8s.PatchUtils.PATCH_FORMAT_JSON_MERGE_PATCH,
  },
}

function warn(message, err) {
  console.warn(`${message}: ${err?.body?.message ?? err?.message ?? err}`)
}

/**
 * Label the volume claims of an existing StatefulSet.
 *
 * Claims created before the deployment label was introduced do not carry
 * it: they would be missed by the label selector used by the deployment
 * status and delete endpoints. Their names follow the pattern
 * <template-name>-<statefulSetName>-<ordinal>, so locate them by name and
 * patch the label in. Best-effort: failures only log, so a missing patch
 * permission cannot break re-deploys (delete matches unlabeled claims by
 * name as a fallback).
 */
export async function labelExistingVolumeClaims(statefulSetName) {
  const client = getKubernetesClient(servicesNamespace)
  let items = []
  try {
    const response =
      await client.listNamespacedPersistentVolumeClaim(servicesNamespace)
    items = response.body.items
  } catch (err) {
    return warn(
      `Could not list volume claims to label for ${statefulSetName}`,
      err
    )
  }
  for (const item of items) {
    const name = item?.metadata?.name
    if (
      !isVolumeClaimOf(name, statefulSetName) ||
      item?.metadata?.labels?.[APP_LABEL_KEY] === statefulSetName
    ) {
      continue
    }
    try {
      await client.patchNamespacedPersistentVolumeClaim(
        name,
        servicesNamespace,
        { metadata: { labels: { [APP_LABEL_KEY]: statefulSetName } } },
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        mergePatch
      )
    } catch (err) {
      warn(`Could not label volume claim ${name}`, err)
    }
  }
}
