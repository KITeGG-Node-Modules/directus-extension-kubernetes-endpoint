import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { appsClient, coreClient, customClient } = vi.hoisted(() => ({
  appsClient: {
    readNamespacedStatefulSet: vi.fn(),
  },
  coreClient: {
    listNamespacedPod: vi.fn(),
    connectGetNodeProxy: vi.fn(),
    connectGetNodeProxyWithPath: vi.fn(),
  },
  customClient: {
    listNamespacedCustomObject: vi.fn(),
  },
}))

vi.mock('../src/lib/get-kubernetes-client.js', () => ({
  // The extension requests clients by API class; tell them apart by a
  // method each generated class only provides (names are unreliable
  // under bundling)
  getKubernetesClient: (_namespace, api) => {
    if (api?.prototype?.readNamespacedStatefulSet) return appsClient
    if (api?.prototype?.listNamespacedCustomObject) return customClient
    return coreClient
  },
}))

import { getDeploymentStats } from '../src/get-deployment-stats.js'

function mockStatefulSet(limits = { cpu: '4', memory: '32Gi' }) {
  appsClient.readNamespacedStatefulSet.mockResolvedValue({
    body: {
      spec: {
        template: {
          spec: {
            containers: [
              { name: 'nginx', resources: { limits } },
              { name: 'sidecar' },
            ],
          },
        },
      },
    },
  })
}

function mockPods(pods) {
  coreClient.listNamespacedPod.mockResolvedValue({ body: { items: pods } })
}

function mockMetrics(items, available = true) {
  if (available) {
    customClient.listNamespacedCustomObject.mockResolvedValue({
      body: { items },
    })
  } else {
    const notFound = Object.assign(
      new Error('the server could not find the requested resource'),
      {
        statusCode: 404,
        body: { code: 404, reason: 'NotFound' },
      }
    )
    customClient.listNamespacedCustomObject.mockRejectedValue(notFound)
  }
}

function mockKubeletSummaries(byNode) {
  coreClient.connectGetNodeProxy.mockImplementation(async (nodeName) => ({
    body: byNode[nodeName],
  }))
}

const POD = {
  metadata: { name: 'sd-5-0', labels: { app: 'sd-5' } },
  spec: {
    nodeName: 'worker-1',
    containers: [
      {
        name: 'nginx',
        resources: { limits: { 'nvidia.com/gpu': 1 } },
      },
    ],
  },
  status: { phase: 'Running' },
}

const METRIC = {
  metadata: { name: 'sd-5-0' },
  timestamp: '2026-11-04T14:00:00Z',
  window: '30s',
  containers: [{ name: 'nginx', usage: { cpu: '12m', memory: '258Mi' } }],
}

const SUMMARY = {
  pods: [
    {
      podRef: { name: 'sd-5-0', namespace: 'services' },
      volume: [
        {
          name: 'mydata-sd-5-0',
          pvcRef: { namespace: 'services', name: 'mydata-sd-5-0' },
          availableBytes: 1072693248,
          capacityBytes: 1073741824,
          usedBytes: 1048576,
          inodesFree: 5242868,
          inodesUsed: 12,
          inodes: 5242880,
          time: '2026-11-04T14:00:00Z',
        },
      ],
    },
  ],
}

describe('getDeploymentStats', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    mockStatefulSet()
    // The GPU part issues Prometheus instant queries; default to an
    // unreachable Prometheus so tests exercise the degradation path
    fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED'))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('reports container usage, limits and volume stats', async () => {
    mockPods([POD])
    mockMetrics([METRIC])
    mockKubeletSummaries({ 'worker-1': SUMMARY })

    const stats = await getDeploymentStats({ id: '5' })
    expect(stats.metricsAvailable).toBe(true)
    expect(stats.volumeStatsAvailable).toBe(true)

    const pod = stats.pods[0]
    expect(pod.name).toBe('sd-5-0')
    expect(pod.node).toBe('worker-1')
    expect(pod.usage).toEqual({
      cpuCores: 0.012,
      memoryBytes: 258 * 1024 ** 2,
      timestamp: '2026-11-04T14:00:00Z',
      window: '30s',
    })
    expect(pod.containers[0]).toEqual({
      name: 'nginx',
      usage: {
        cpu: '12m',
        cpuCores: 0.012,
        memory: '258Mi',
        memoryBytes: 258 * 1024 ** 2,
      },
      limits: { cpu: '4', memory: '32Gi' },
    })

    // Volume usage from the kubelet summary, joined with mount paths
    expect(pod.volumes[0]).toMatchObject({
      name: 'mydata-sd-5-0',
      claimName: 'mydata-sd-5-0',
      usedBytes: 1048576,
      capacityBytes: 1073741824,
      availableBytes: 1072693248,
      inodesUsed: 12,
      inodesTotal: 5242880,
    })
  })

  it('reports current GPU usage per pod from DCGM instant queries', async () => {
    mockPods([POD])
    mockMetrics([METRIC])
    mockKubeletSummaries({ 'worker-1': SUMMARY })
    // Three instant queries: DCGM_FI_DEV_GPU_UTIL (utilization),
    // DCGM_FI_PROF_GR_ENGINE_ACTIVE (MIG fallback, empty here) and
    // DCGM_FI_DEV_FB_USED (framebuffer, 4096 MiB)
    fetchMock.mockImplementation(async (url) => {
      const query = new URL(url).searchParams.get('query')
      const result = query.includes('DCGM_FI_DEV_FB_USED')
        ? [
            {
              metric: { pod: 'sd-5-0', gpu: '0', UUID: 'GPU-abc' },
              value: [1794180000, '4096'],
            },
          ]
        : []
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: 'success',
          data: { resultType: 'vector', result },
        }),
      }
    })
    // First call (DCGM_FI_DEV_GPU_UTIL) returns the utilization sample
    const calls = []
    fetchMock.mockImplementation(async (url) => {
      calls.push(url)
      const query = new URL(url).searchParams.get('query')
      const result = query.includes('DCGM_FI_DEV_GPU_UTIL')
        ? [
            {
              metric: {
                pod: 'sd-5-0',
                gpu: '0',
                UUID: 'GPU-abc',
                modelName: 'NVIDIA A100',
              },
              value: [1794180000, '87'],
            },
          ]
        : query.includes('DCGM_FI_DEV_FB_USED')
          ? [
              {
                metric: { pod: 'sd-5-0', gpu: '0', UUID: 'GPU-abc' },
                value: [1794180000, '4096'],
              },
            ]
          : []
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: 'success',
          data: { resultType: 'vector', result },
        }),
      }
    })

    const stats = await getDeploymentStats({ id: '5' })
    expect(stats.gpuMetricsAvailable).toBe(true)
    expect(stats.pods[0].gpus).toEqual([
      {
        gpu: '0',
        uuid: 'GPU-abc',
        gpuInstanceId: null,
        migProfile: null,
        modelName: 'NVIDIA A100',
        utilizationPercent: 87,
        memoryBytes: 4096 * 1024 ** 2,
        // the FB_FREE query returned nothing in this fixture
        capacityBytes: null,
      },
    ])
    // the pod's own grant, from its spec's GPU resource limits
    expect(stats.pods[0].gpuAllocation).toEqual([
      { resource: 'nvidia.com/gpu', count: 1 },
    ])
    // the DCGM queries are scoped to the deployment's pods (backslash
    // doubled for the PromQL string literal, see lib/prometheus.js)
    const gpuQuery = calls
      .map((url) => new URL(url).searchParams.get('query'))
      .find((query) => query.includes('DCGM_FI_DEV_GPU_UTIL'))
    expect(gpuQuery).toContain('pod=~"^sd-5-\\\\d+$"')
  })

  it('reports current network I/O per pod from cAdvisor instant queries', async () => {
    mockPods([POD])
    mockMetrics([METRIC])
    mockKubeletSummaries({ 'worker-1': SUMMARY })
    const calls = []
    fetchMock.mockImplementation(async (url) => {
      calls.push(url)
      const query = new URL(url).searchParams.get('query')
      const rate = query.includes('rate(container_network_')
      const receive = query.includes('container_network_receive_bytes_total')
      // rates: 12.5 KiB/s in, 3.5 KiB/s out; totals: 1 MiB in, 0.5 MiB out
      const value = rate
        ? receive
          ? '12800'
          : '3584'
        : receive
          ? '1048576'
          : '524288'
      const result = query.includes('container_network_')
        ? [{ metric: { pod: 'sd-5-0' }, value: [1794180000, String(value)] }]
        : []
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: 'success',
          data: { resultType: 'vector', result },
        }),
      }
    })

    const stats = await getDeploymentStats({ id: '5' })
    expect(stats.networkMetricsAvailable).toBe(true)
    expect(stats.pods[0].network).toEqual({
      receiveBytesPerSecond: 12800,
      transmitBytesPerSecond: 3584,
      receiveBytesTotal: 1048576,
      transmitBytesTotal: 524288,
    })
    // the network queries are scoped to the deployment's pods and rate
    // over a 5m window
    const rateQuery = calls
      .map((url) => new URL(url).searchParams.get('query'))
      .find((query) => query.includes('rate(container_network_receive'))
    expect(rateQuery).toContain(
      'sum by (pod) (rate(container_network_receive_bytes_total{pod=~"^sd-5-\\\\d+$"}[300s]))'
    )
  })

  it('reports MIG slice profile, capacity and the GPU allocation', async () => {
    const pod = structuredClone(POD)
    pod.spec.containers[0].resources.limits = {
      'nvidia.com/mig-1g.10gb': 1,
    }
    mockPods([pod])
    mockMetrics([METRIC])
    mockKubeletSummaries({ 'worker-1': SUMMARY })
    fetchMock.mockImplementation(async (url) => {
      const query = new URL(url).searchParams.get('query')
      const device = {
        pod: 'sd-5-0',
        gpu: '0',
        UUID: 'GPU-abc',
        GPU_I_ID: '3',
        GPU_I_PROFILE: '1g.10gb',
      }
      const result = query.includes('DCGM_FI_DEV_GPU_UTIL')
        ? [{ metric: device, value: [1794180000, '87'] }]
        : query.includes('DCGM_FI_DEV_FB_USED')
          ? [{ metric: device, value: [1794180000, '2048'] }]
          : query.includes('DCGM_FI_DEV_FB_FREE')
            ? [{ metric: device, value: [1794180000, '8192'] }]
            : []
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: 'success',
          data: { resultType: 'vector', result },
        }),
      }
    })

    const stats = await getDeploymentStats({ id: '5' })
    expect(stats.pods[0].gpus).toEqual([
      {
        gpu: '0',
        uuid: 'GPU-abc',
        gpuInstanceId: '3',
        migProfile: '1g.10gb',
        modelName: null,
        utilizationPercent: 87,
        // slice capacity = FB_USED + FB_FREE (10 GiB for a 1g.10gb),
        // not the whole GPU's memory
        memoryBytes: 2048 * 1024 ** 2,
        capacityBytes: 1024 ** 3 * 10,
      },
    ])
    expect(stats.pods[0].gpuAllocation).toEqual([
      { resource: 'nvidia.com/mig-1g.10gb', count: 1 },
    ])
  })

  it('degrades network usage silently when Prometheus is unreachable', async () => {
    mockPods([POD])
    mockMetrics([METRIC])
    mockKubeletSummaries({ 'worker-1': SUMMARY })

    const stats = await getDeploymentStats({ id: '5' })
    expect(stats.networkMetricsAvailable).toBe(false)
    expect(stats.pods[0].network).toEqual({
      receiveBytesPerSecond: null,
      transmitBytesPerSecond: null,
      receiveBytesTotal: null,
      transmitBytesTotal: null,
    })
  })

  it('falls back to the MIG profile metric when GPU_UTIL is absent', async () => {
    mockPods([POD])
    mockMetrics([METRIC])
    mockKubeletSummaries({ 'worker-1': SUMMARY })
    fetchMock.mockImplementation(async (url) => {
      const query = new URL(url).searchParams.get('query')
      const result = query.includes('DCGM_FI_PROF_GR_ENGINE_ACTIVE')
        ? [
            {
              metric: { pod: 'sd-5-0', gpu: '0', UUID: 'GPU-mig' },
              value: [1794180000, '0.87'],
            },
          ]
        : []
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: 'success',
          data: { resultType: 'vector', result },
        }),
      }
    })

    const stats = await getDeploymentStats({ id: '5' })
    // 0.87 engine-active fraction → 87 percent
    expect(stats.pods[0].gpus[0].utilizationPercent).toBe(87)
    expect(stats.pods[0].gpus[0].memoryBytes).toBeNull()
  })

  it('degrades GPU usage silently when Prometheus is unreachable', async () => {
    mockPods([POD])
    mockMetrics([METRIC])
    mockKubeletSummaries({ 'worker-1': SUMMARY })

    const stats = await getDeploymentStats({ id: '5' })
    expect(stats.gpuMetricsAvailable).toBe(false)
    expect(stats.pods[0].gpus).toEqual([])
    // CPU/memory/volume stats are unaffected
    expect(stats.metricsAvailable).toBe(true)
    expect(stats.volumeStatsAvailable).toBe(true)
  })

  it('joins volume usage with the mount paths of the deployment YAML', async () => {
    const pod = structuredClone(POD)
    pod.spec.containers[0].volumeMounts = [
      { name: 'mydata-sd-5-0', mountPath: '/mydata' },
    ]
    mockPods([pod])
    mockMetrics([METRIC])
    mockKubeletSummaries({ 'worker-1': SUMMARY })

    const stats = await getDeploymentStats({ id: '5' })
    expect(stats.pods[0].volumes[0].mountPaths).toEqual(['/mydata'])
  })

  it('degrades gracefully when the metrics API is not installed', async () => {
    mockPods([POD])
    mockMetrics([], false)
    mockKubeletSummaries({ 'worker-1': SUMMARY })

    const stats = await getDeploymentStats({ id: '5' })
    expect(stats.metricsAvailable).toBe(false)
    expect(stats.pods[0].containers).toEqual([])
    expect(stats.pods[0].usage.cpuCores).toBeNull()
    // volume stats are unaffected
    expect(stats.volumeStatsAvailable).toBe(true)
    expect(stats.pods[0].volumes).toHaveLength(1)
  })

  it('degrades gracefully when the kubelet stats summary is unreachable', async () => {
    mockPods([POD])
    mockMetrics([METRIC])
    const failure = Object.assign(new Error('connect ECONNREFUSED'), {
      statusCode: 500,
    })
    coreClient.connectGetNodeProxy.mockRejectedValue(failure)
    coreClient.connectGetNodeProxyWithPath.mockRejectedValue(failure)

    const stats = await getDeploymentStats({ id: '5' })
    expect(stats.volumeStatsAvailable).toBe(false)
    expect(stats.warnings).toHaveLength(1)
    expect(stats.warnings[0]).toContain('worker-1')
    // resource usage is unaffected
    expect(stats.metricsAvailable).toBe(true)
    expect(stats.pods[0].containers[0].usage.cpu).toBe('12m')
  })

  it('reports authorization failures on the stats summary as a warning', async () => {
    mockPods([POD])
    mockMetrics([METRIC])
    const forbidden = Object.assign(new Error('forbidden'), {
      statusCode: 403,
      body: { code: 403, message: 'nodes/proxy is forbidden' },
    })
    coreClient.connectGetNodeProxy.mockRejectedValue(forbidden)

    const stats = await getDeploymentStats({ id: '5' })
    expect(stats.volumeStatsAvailable).toBe(false)
    expect(stats.warnings[0]).toContain('nodes/proxy is forbidden')
  })

  it('fetches one summary per unique node', async () => {
    const pod2 = structuredClone(POD)
    pod2.metadata.name = 'sd-5-1'
    const pod3 = structuredClone(POD)
    pod3.metadata.name = 'sd-5-2'
    pod3.spec.nodeName = 'worker-2'
    mockPods([POD, pod2, pod3])
    mockMetrics([METRIC])
    mockKubeletSummaries({ 'worker-1': SUMMARY, 'worker-2': SUMMARY })

    await getDeploymentStats({ id: '5' })
    expect(coreClient.connectGetNodeProxy).toHaveBeenCalledTimes(2)
    expect(coreClient.connectGetNodeProxy.mock.calls.map((c) => c[0])).toEqual([
      'worker-1',
      'worker-2',
    ])
  })

  it('falls back to the /proxy/{path} URL form for the stats summary', async () => {
    mockPods([POD])
    mockMetrics([METRIC])
    coreClient.connectGetNodeProxy.mockRejectedValue(new Error('unexpected'))
    coreClient.connectGetNodeProxyWithPath.mockResolvedValue({ body: SUMMARY })

    const stats = await getDeploymentStats({ id: '5' })
    expect(stats.volumeStatsAvailable).toBe(true)
    expect(coreClient.connectGetNodeProxyWithPath).toHaveBeenCalledWith(
      'worker-1',
      'stats/summary'
    )
  })

  it('limits stats to the requested pod and returns null for foreign pod names', async () => {
    mockPods([POD])
    mockMetrics([METRIC])
    mockKubeletSummaries({ 'worker-1': SUMMARY })

    await getDeploymentStats({ id: '5' }, 'sd-5-0')
    expect(coreClient.listNamespacedPod).toHaveBeenCalledWith(
      'services',
      undefined,
      undefined,
      undefined,
      'metadata.name=sd-5-0',
      'app=sd-5'
    )

    // A pod name from another deployment matches nothing
    mockPods([])
    const stats = await getDeploymentStats({ id: '5' }, 'sd-999-0')
    expect(stats).toBeNull()
  })

  it('omits limits for containers that declare none', async () => {
    mockPods([POD])
    mockMetrics([
      {
        ...METRIC,
        containers: [
          { name: 'nginx', usage: { cpu: '12m', memory: '258Mi' } },
          { name: 'extra', usage: { cpu: '1m', memory: '10Mi' } },
        ],
      },
    ])
    mockKubeletSummaries({ 'worker-1': SUMMARY })

    const stats = await getDeploymentStats({ id: '5' })
    const containers = stats.pods[0].containers
    expect(containers.find((c) => c.name === 'nginx').limits).toEqual({
      cpu: '4',
      memory: '32Gi',
    })
    expect(containers.find((c) => c.name === 'extra').limits).toBeNull()
    // pod usage aggregates all sampled containers
    expect(stats.pods[0].usage.cpuCores).toBeCloseTo(0.013)
  })
})
