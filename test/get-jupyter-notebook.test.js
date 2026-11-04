import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const configState = vi.hoisted(() => ({
  jupyterhubUrl: 'https://hub.example',
  jupyterhubApiToken: 'hub-token',
}))

const { coreClient, summaryMock } = vi.hoisted(() => ({
  coreClient: {
    readNamespacedPod: vi.fn(),
    readNamespacedPersistentVolumeClaim: vi.fn(),
  },
  summaryMock: vi.fn(),
}))

vi.mock('../src/lib/config.js', () => ({
  // Getters, so tests can flip the jupyterhub configuration after import
  get servicesNamespace() {
    return 'services'
  },
  get jupyterhubNamespace() {
    return 'jupyterhub'
  },
  get jupyterhubUrl() {
    return configState.jupyterhubUrl
  },
  get jupyterhubApiToken() {
    return configState.jupyterhubApiToken
  },
  get jupyterhubHomeMountPath() {
    return '/home/jovyan'
  },
}))

vi.mock('../src/lib/get-kubernetes-client.js', () => ({
  getKubernetesClient: () => coreClient,
}))

vi.mock('../src/lib/kubelet-summary.js', () => ({
  getKubeletStatsSummary: summaryMock,
}))

import { getJupyterNotebook } from '../src/get-jupyter-notebook.js'

const fetchMock = vi.fn()

function mockHubUser(payload, status = 200) {
  fetchMock.mockResolvedValue({
    ok: status < 400,
    status,
    json: async () => payload,
  })
}

const POD = {
  metadata: { name: 'jupyter-john' },
  spec: {
    nodeName: 'worker-1',
    containers: [
      {
        name: 'notebook',
        volumeMounts: [{ name: 'user-storage', mountPath: '/home/jovyan' }],
      },
    ],
    volumes: [
      {
        name: 'user-storage',
        persistentVolumeClaim: { claimName: 'claim-john' },
      },
    ],
  },
  status: {
    phase: 'Running',
    startTime: '2026-11-05T08:55:00Z',
    containerStatuses: [
      {
        ready: true,
        state: { running: { startedAt: '2026-11-05T09:00:00Z' } },
      },
    ],
  },
}

const PVC = { status: { capacity: { storage: '10Gi' } } }

const SUMMARY = {
  pods: [
    {
      podRef: { name: 'jupyter-john' },
      volume: [
        {
          pvcRef: { namespace: 'jupyterhub', name: 'claim-john' },
          usedBytes: 123,
          availableBytes: 456,
        },
      ],
    },
  ],
}

describe('getJupyterNotebook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    configState.jupyterhubUrl = 'https://hub.example'
    configState.jupyterhubApiToken = 'hub-token'
    vi.stubGlobal('fetch', fetchMock)
    coreClient.readNamespacedPod.mockResolvedValue({ body: POD })
    coreClient.readNamespacedPersistentVolumeClaim.mockResolvedValue({
      body: PVC,
    })
    summaryMock.mockResolvedValue(SUMMARY)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reports a running notebook with folder volume usage', async () => {
    mockHubUser({
      name: 'john',
      servers: {
        '': { ready: true, pending: null, state: { pod_name: 'jupyter-john' } },
      },
    })

    const notebook = await getJupyterNotebook('john')
    expect(notebook).toEqual({
      available: true,
      running: true,
      pending: null,
      // the default (unnamed) server
      server: null,
      pod: {
        name: 'jupyter-john',
        phase: 'Running',
        startedAt: '2026-11-05T09:00:00Z',
        ready: true,
      },
      volume: {
        claimName: 'claim-john',
        capacityBytes: 10 * 1024 ** 3,
        usedBytes: 123,
        availableBytes: 456,
      },
    })

    // the pod is read from the jupyterhub namespace, by the name the hub
    // reported — no username escaping guesswork
    expect(coreClient.readNamespacedPod).toHaveBeenCalledWith(
      'jupyter-john',
      'jupyterhub'
    )
    expect(coreClient.readNamespacedPersistentVolumeClaim).toHaveBeenCalledWith(
      'claim-john',
      'jupyterhub'
    )
    const hubUrl = new URL(fetchMock.mock.calls[0][0])
    expect(hubUrl.pathname).toBe('/hub/api/users/john')
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(
      'token hub-token'
    )
  })

  it('reports a not-running notebook without volume stats', async () => {
    // a stopped server is absent from the `servers` map
    mockHubUser({ name: 'john', servers: {} })

    const notebook = await getJupyterNotebook('john')
    expect(notebook.running).toBe(false)
    expect(notebook.pod).toBeNull()
    expect(notebook.volume).toBeNull()
    expect(coreClient.readNamespacedPod).not.toHaveBeenCalled()
  })

  it('reports a user the hub does not know as not running', async () => {
    mockHubUser({ message: 'User not found' }, 404)

    const notebook = await getJupyterNotebook('nobody')
    expect(notebook).toEqual({
      available: true,
      running: false,
      pod: null,
      volume: null,
    })
  })

  it('reports a pending spawn with the pod phase', async () => {
    const pendingPod = structuredClone(POD)
    pendingPod.status.phase = 'Pending'
    pendingPod.status.containerStatuses = []
    coreClient.readNamespacedPod.mockResolvedValue({ body: pendingPod })
    mockHubUser({
      name: 'john',
      servers: {
        '': {
          ready: false,
          pending: 'spawn',
          state: { pod_name: 'jupyter-john' },
        },
      },
    })

    const notebook = await getJupyterNotebook('john')
    expect(notebook.running).toBe(false)
    expect(notebook.pending).toBe('spawn')
    expect(notebook.pod.phase).toBe('Pending')
    // no started container — falls back to the pod start time
    expect(notebook.pod.startedAt).toBe('2026-11-05T08:55:00Z')
    expect(notebook.pod.ready).toBe(false)
  })

  it('degrades folder usage to nulls when the kubelet summary is unavailable', async () => {
    summaryMock.mockRejectedValue(new Error('connect ECONNREFUSED'))
    mockHubUser({
      name: 'john',
      servers: {
        '': { ready: true, pending: null, state: { pod_name: 'jupyter-john' } },
      },
    })

    const notebook = await getJupyterNotebook('john')
    expect(notebook.running).toBe(true)
    // capacity ("max") still comes from the PVC status
    expect(notebook.volume).toEqual({
      claimName: 'claim-john',
      capacityBytes: 10 * 1024 ** 3,
      usedBytes: null,
      availableBytes: null,
    })
  })

  it('falls back to the first PVC when the home mount path is absent', async () => {
    const pod = structuredClone(POD)
    pod.spec.containers[0].volumeMounts = []
    coreClient.readNamespacedPod.mockResolvedValue({ body: pod })
    mockHubUser({
      name: 'john',
      servers: {
        '': { ready: true, pending: null, state: { pod_name: 'jupyter-john' } },
      },
    })

    const notebook = await getJupyterNotebook('john')
    expect(notebook.volume.claimName).toBe('claim-john')
  })

  it('degrades to unavailable when the JupyterHub integration is not configured', async () => {
    configState.jupyterhubUrl = ''
    const notebook = await getJupyterNotebook('john')
    expect(notebook).toEqual({
      available: false,
      reason: 'jupyterhub_not_configured',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
