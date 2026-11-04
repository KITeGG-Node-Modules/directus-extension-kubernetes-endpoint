// SPDX-License-Identifier: EUPL-1.2
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { kubeConfigFake, httpsRequestSpy, setResponder } = vi.hoisted(() => {
  // minimal https.ClientRequest shape: emits the response passed here
  let responder = null
  const requestSpy = vi.fn((options, callback) => {
    const request = {
      setTimeout: vi.fn(),
      destroy: vi.fn(),
      end: vi.fn(() => {
        if (responder) responder(options, callback)
      }),
      on: vi.fn(),
    }
    return request
  })
  return {
    kubeConfigFake: {
      getCurrentCluster: vi.fn(() => ({
        server: 'https://api.example:6443',
        caData: 'base64-ca',
      })),
      getCurrentUser: vi.fn(() => ({ token: 'sa-token' })),
      applytoHTTPSOptions: vi.fn(async (options) => {
        options.ca = Buffer.from('ca')
        options.rejectUnauthorized = true
        options.headers.Authorization = 'Bearer sa-token'
      }),
    },
    httpsRequestSpy: requestSpy,
    setResponder(fn) {
      responder = fn
    },
  }
})

vi.mock('../src/lib/get-kubernetes-client.js', () => ({
  getKubeConfig: () => kubeConfigFake,
}))

vi.mock('node:https', () => ({ request: httpsRequestSpy, default: { request: httpsRequestSpy } }))

import { getKubeletStatsSummary } from '../src/lib/kubelet-summary.js'

function respondWith(statusCode, body) {
  const chunks = Array.isArray(body) ? body : [body]
  setResponder((options, callback) => {
    expect(options.headers.Accept).toBe('application/json')
    callback({
      statusCode,
      on(event, handler) {
        if (event === 'data') chunks.forEach((chunk) => handler(Buffer.from(chunk)))
        if (event === 'end') handler()
      },
    })
  })
}

describe('getKubeletStatsSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    setResponder(null)
  })

  it('requests the plain proxy path (no query form, no percent-encoding)', async () => {
    respondWith(200, '{"pods":[]}')
    const summary = await getKubeletStatsSummary({}, 'work-d')
    expect(summary).toEqual({ pods: [] })
    expect(httpsRequestSpy).toHaveBeenCalledTimes(1)
    const options = httpsRequestSpy.mock.calls[0][0]
    expect(options.hostname).toBe('api.example')
    expect(options.port).toBe('6443')
    expect(options.path).toBe('/api/v1/nodes/work-d/proxy/stats/summary')
    expect(options.path).not.toContain('%2F')
    expect(options.path).not.toContain('path=')
  })

  it('applies the kube config TLS material and bearer token', async () => {
    respondWith(200, '{}')
    await getKubeletStatsSummary({}, 'work-d')
    const options = httpsRequestSpy.mock.calls[0][0]
    expect(kubeConfigFake.applytoHTTPSOptions).toHaveBeenCalledWith(options)
    expect(options.headers.Authorization).toBe('Bearer sa-token')
    expect(options.ca).toEqual(Buffer.from('ca'))
  })

  it('throws with the status code when the proxy request fails', async () => {
    respondWith(403, 'Forbidden')
    await expect(getKubeletStatsSummary({}, 'work-d')).rejects.toMatchObject({
      statusCode: 403,
    })
  })

  it('throws when no cluster server is configured', async () => {
    kubeConfigFake.getCurrentCluster.mockReturnValueOnce(null)
    await expect(getKubeletStatsSummary({}, 'work-d')).rejects.toThrow(
      'no cluster server'
    )
  })
})
