// SPDX-License-Identifier: EUPL-1.2
import { getKubernetesClient } from './lib/get-kubernetes-client.js'
import {
  jupyterhubApiToken,
  jupyterhubHomeMountPath,
  jupyterhubNamespace,
  jupyterhubUrl,
} from './lib/config.js'
import { getJupyterHubUser } from './lib/jupyterhub.js'
import { getKubeletStatsSummary } from './lib/kubelet-summary.js'
import { isNotFound } from './lib/is-not-found.js'
import { parseQuantity } from './lib/quantity.js'

/**
 * The claim backing the user folder volume of a singleuser pod: the
 * volume mounted at the home mount path (the JupyterHub user folder),
 * falling back to the pod's first PVC. Returns null when the pod mounts
 * no persistent volume.
 */
function findUserFolderClaim(pod) {
  const volumes = pod.spec?.volumes ?? []
  const homeMount = (pod.spec?.containers ?? [])
    .flatMap((container) => container.volumeMounts ?? [])
    .find((mount) => mount.mountPath === jupyterhubHomeMountPath)
  if (homeMount) {
    const claim = volumes.find((volume) => volume.name === homeMount.name)
      ?.persistentVolumeClaim?.claimName
    if (claim) return claim
  }
  return (
    volumes.find((volume) => volume.persistentVolumeClaim)
      ?.persistentVolumeClaim?.claimName ?? null
  )
}

/**
 * Actual usage of the user folder claim, from the kubelet stats summary
 * of the node the notebook runs on — the PVC status alone does not carry
 * used bytes. Degrades to nulls when the pod has no node yet or the
 * summary cannot be fetched (missing nodes/proxy RBAC, kubelet unreachable).
 */
function folderUsage(summary, podName, claimName) {
  const result = {
    usedBytes: null,
    availableBytes: null,
    usageWarning: null,
  }
  if (!claimName) return result
  if (!podName) {
    // the notebook is stopped — the claim is not mounted anywhere, so
    // its usage is genuinely not measurable (not a warning)
    return result
  }
  if (!summary) {
    result.usageWarning = 'kubelet_stats_unavailable'
    return result
  }
  const summaryPod = (summary.pods ?? []).find(
    (entry) => entry.podRef?.name === podName
  )
  if (!summaryPod) {
    result.usageWarning = `pod_not_in_summary: ${podName}`
    return result
  }
  const volume = (summaryPod?.volume ?? []).find(
    (entry) => entry.pvcRef?.name === claimName
  )
  if (!volume) {
    result.usageWarning = `claim_not_in_summary: ${claimName}`
    return result
  }
  result.usedBytes = volume?.usedBytes ?? null
  result.availableBytes = volume?.availableBytes ?? null
  return result
}

/**
 * The requesting user's Jupyter notebook state and user folder volume
 * statistics. The hub username is resolved by the caller (Keycloak
 * username = JupyterHub username, the mapping the reservations-watcher
 * also relies on).
 *
 * The notebook's running state comes from the JupyterHub API
 * (`servers[''].ready`), which also provides the actual pod name — no
 * reproduction of KubeSpawner's username escaping needed. The folder
 * volume ("max") is read from the PVC's status capacity; "used" comes
 * from the kubelet stats summary, so it is only observable while the
 * notebook holds the claim mounted (a stopped notebook releases it).
 *
 * Degrades instead of failing: without JUPYTERHUB_API_URL the response is
 * { available: false }; a hub user that never spawned yields
 * { running: false }; volume usage degrades to nulls without kubelet
 * access. Kubernetes errors (pod/PVC reads) propagate.
 */
export async function getJupyterNotebook(username) {
  if (!jupyterhubUrl || !jupyterhubApiToken) {
    return { available: false, reason: 'jupyterhub_not_configured' }
  }

  const hubUser = await getJupyterHubUser(
    jupyterhubUrl,
    jupyterhubApiToken,
    username
  )
  if (!hubUser) {
    // The hub does not know this user — they never started a notebook
    return { available: true, running: false, pod: null, volume: null }
  }

  // Default server first (the LLP's model), else the first entry
  const serverEntries = Object.entries(hubUser.servers ?? {})
  const serverEntry =
    serverEntries.find(([name]) => name === '') ?? serverEntries[0]
  const serverName = serverEntry?.[0] ?? ''
  const server = serverEntry?.[1] ?? null
  const podName = server?.state?.pod_name ?? null

  const coreClient = getKubernetesClient(jupyterhubNamespace)
  let pod = null
  if (podName) {
    try {
      const { body } = await coreClient.readNamespacedPod(
        podName,
        jupyterhubNamespace
      )
      pod = body
    } catch (err) {
      // a stopped notebook leaves stale pod state in the hub — the read
      // 404s and the pod is simply gone; other errors propagate
      if (!isNotFound(err)) throw err
    }
  }

  let claimName = pod ? findUserFolderClaim(pod) : null
  let capacityBytes = null
  if (claimName) {
    const { body: claim } =
      await coreClient.readNamespacedPersistentVolumeClaim(
        claimName,
        jupyterhubNamespace
      )
    capacityBytes = parseQuantity(claim.status?.capacity?.storage)
  } else {
    // The claim outlives the notebook: fall back to the spawner's
    // claim-<hub username> convention so the folder usage display works
    // while the notebook is stopped (capacity from the PVC status, usage
    // not measurable without the kubelet entry of a mounting pod).
    // A 404 means this user has no claim — volume stays null.
    try {
      const { body: claim } =
        await coreClient.readNamespacedPersistentVolumeClaim(
          `claim-${hubUser.name}`,
          jupyterhubNamespace
        )
      claimName = `claim-${hubUser.name}`
      capacityBytes = parseQuantity(claim.status?.capacity?.storage)
    } catch (err) {
      if (!isNotFound(err)) throw err
    }
  }

  let summary = null
  let summaryError = null
  const nodeName = pod?.spec?.nodeName ?? null
  if (pod && nodeName) {
    try {
      summary = await getKubeletStatsSummary(coreClient, nodeName)
    } catch (err) {
      // volume usage degrades to nulls — the running state is unaffected.
      // The reason is surfaced in the response: a missing nodes/proxy
      // RBAC grant is the usual cause and is fixable, not ignorable.
      summaryError = err
    }
  }

  const containerStatuses = pod?.status?.containerStatuses ?? []
  return {
    available: true,
    running: server?.ready === true,
    pending: server?.pending ?? null,
    server: serverName || null,
    pod: pod
      ? {
          name: pod.metadata.name,
          phase: pod.status?.phase ?? null,
          startedAt:
            containerStatuses.find((status) => status.state?.running?.startedAt)
              ?.state.running.startedAt ??
            pod.status?.startTime ??
            null,
          ready:
            containerStatuses.length > 0 &&
            containerStatuses.every((status) => status.ready),
        }
      : null,
    volume: claimName
      ? {
          claimName,
          capacityBytes,
          // usage is only measurable while a pod mounts the claim — a
          // stopped notebook (pod null) reports nulls without a warning
          ...folderUsage(summary, pod?.metadata?.name ?? null, claimName),
          ...(summaryError
            ? {
                usageWarning: `kubelet_stats_unavailable: ${
                  summaryError?.message ?? String(summaryError)
                }`,
              }
            : {}),
        }
      : null,
  }
}
