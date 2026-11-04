// SPDX-License-Identifier: EUPL-1.2
import { isNotFound } from './is-not-found.js'

const KUBELET_STATS_SUMMARY_PATH = 'stats/summary'

/**
 * The kubelet's stats summary for one node, fetched through the API
 * server's node proxy (the same data `kubectl get --raw
 * /api/v1/nodes/<node>/proxy/stats/summary` returns). This is the only
 * source of actual volume usage (PVC bytes/inodes as seen by the kubelet)
 * and pod-level device/network stats beyond Prometheus.
 *
 * The generated client offers two ways to address the proxy subresource:
 * the `?path=` query form (NodeProxyOptions) and the `/proxy/{path}` URL
 * form, which the client percent-encodes — encoding the path segment
 * mangles `stats/summary` into `stats%2Fsummary` on the wire, so the
 * query form is used first and the URL form kept as a fallback.
 * Throws when the summary cannot be fetched (missing nodes/proxy RBAC,
 * unreachable kubelet, ...) — callers degrade gracefully.
 */
export async function getKubeletStatsSummary(coreClient, nodeName) {
  const summaryCandidates = [
    () => coreClient.connectGetNodeProxy(nodeName, KUBELET_STATS_SUMMARY_PATH),
    () =>
      coreClient.connectGetNodeProxyWithPath(
        nodeName,
        KUBELET_STATS_SUMMARY_PATH
      ),
  ]
  let lastError
  for (const candidate of summaryCandidates) {
    try {
      const { body } = await candidate()
      return typeof body === 'string' ? JSON.parse(body) : body
    } catch (err) {
      if (
        isNotFound(err) ||
        err?.statusCode === 403 ||
        err?.body?.code === 403
      ) {
        // A missing node, an API-server RBAC denial or a kubelet
        // authorization failure will not go away by trying another call
        // shape — surface it to the caller instead of silently retrying
        throw err
      }
      lastError = err
    }
  }
  throw lastError
}
