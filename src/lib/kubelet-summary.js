// SPDX-License-Identifier: EUPL-1.2
import http from 'node:http'
import https from 'node:https'
import { getKubeConfig } from './get-kubernetes-client.js'

const KUBELET_STATS_SUMMARY_PATH = 'stats/summary'
const REQUEST_TIMEOUT_MS = 10_000

/**
 * The kubelet's stats summary for one node, fetched through the API
 * server's node proxy (the same data `kubectl get --raw
 * /api/v1/nodes/<node>/proxy/stats/summary` returns). This is the only
 * source of actual volume usage (PVC bytes/inodes as seen by the kubelet)
 * and pod-level device/network stats beyond Prometheus.
 *
 * The request is issued directly instead of through the generated client:
 * both of the client's node-proxy shapes are unusable — the `?path=`
 * query form (NodeProxyOptions) is rejected by current API servers
 * (NotFound), and the URL form percent-encodes the path segment, mangling
 * `stats/summary` into `stats%2Fsummary` on the wire (also NotFound). The
 * plain path form `/proxy/stats/summary` is the only shape the API server
 * serves. TLS material and the Authorization header come from the same
 * KubeConfig the Kubernetes clients are built from
 * (`applytoHTTPSOptions`), so identity and cluster match everywhere.
 *
 * Throws when the summary cannot be fetched (missing nodes/proxy RBAC,
 * unreachable kubelet, timeout, ...) — callers degrade gracefully.
 */
export async function getKubeletStatsSummary(coreClient, nodeName) {
  // coreClient is kept in the signature for continuity — the transport no
  // longer goes through the generated client; the request reuses the same
  // KubeConfig that client was built from
  void coreClient
  const kc = getKubeConfig()
  const cluster = kc.getCurrentCluster()
  if (!cluster?.server) {
    throw new Error('no cluster server in the kube config')
  }

  const url = new URL(
    `/api/v1/nodes/${encodeURIComponent(nodeName)}/proxy/${KUBELET_STATS_SUMMARY_PATH}`,
    cluster.server
  )
  const isHttps = url.protocol === 'https:'
  const options = {
    method: 'GET',
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: `${url.pathname}${url.search}`,
    headers: { Accept: 'application/json' },
  }
  // ca / client cert / key / rejectUnauthorized / Authorization header —
  // exactly what the generated clients would send
  await kc.applytoHTTPSOptions(options)

  const body = await new Promise((resolve, reject) => {
    const request = (isHttps ? https : http).request(options, (response) => {
      const chunks = []
      response.on('data', (chunk) => chunks.push(chunk))
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8')
        if (response.statusCode >= 400) {
          const error = new Error(
            `node proxy for ${nodeName} returned ${response.statusCode}: ${text.slice(0, 200)}`
          )
          error.statusCode = response.statusCode
          reject(error)
          return
        }
        resolve(text)
      })
    })
    request.setTimeout(REQUEST_TIMEOUT_MS, () => {
      request.destroy(new Error(`node proxy for ${nodeName} timed out`))
    })
    request.on('error', reject)
    request.end()
  })

  return JSON.parse(body)
}
