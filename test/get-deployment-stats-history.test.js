import { beforeEach, describe, expect, it, vi } from 'vitest'

const configState = vi.hoisted(() => ({
  prometheusUrl: 'http://prometheus-operated.prometheus.svc:9090',
}))

vi.mock('../src/lib/config.js', () => ({
  // Getters, so tests can flip prometheusUrl after import — the module
  // under test reads the live binding
  get servicesNamespace() {
    return 'services'
  },
  get prometheusUrl() {
    return configState.prometheusUrl
  },
}))

import {
  getDeploymentStatsHistory,
  parseDuration,
} from '../src/get-deployment-stats-history.js'

const fetchMock = vi.fn()

function mockPrometheus(result) {
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({
      status: 'success',
      data: { resultType: 'matrix', result },
    }),
  })
}

function matrixResult(label, labelValue, values) {
  return {
    metric: { [label]: labelValue },
    values: values.map(([ts, v]) => [ts, String(v)]),
  }
}

const CONTAINER_RESULT = [
  matrixResult('container', 'nginx', [
    [1794180000, 0.012],
    [1794180300, 0.014],
  ]),
]
const VOLUME_RESULT = [
  matrixResult('persistentvolumeclaim', 'mydata-sd-5-0', [
    [1794180000, 1048576],
  ]),
]

describe('parseDuration', () => {
  it('parses single-unit Prometheus durations', () => {
    expect(parseDuration('45s')).toBe(45)
    expect(parseDuration('10m')).toBe(600)
    expect(parseDuration('1h')).toBe(3600)
    expect(parseDuration('7d')).toBe(604800)
  })

  it('rejects invalid durations', () => {
    expect(parseDuration('')).toBeNull()
    expect(parseDuration('1y')).toBeNull()
    expect(parseDuration('-5m')).toBeNull()
    expect(parseDuration('5')).toBeNull()
    expect(parseDuration(null)).toBeNull()
    expect(parseDuration(300)).toBeNull()
  })
})

describe('getDeploymentStatsHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    configState.prometheusUrl = 'http://prometheus-operated.prometheus.svc:9090'
    vi.stubGlobal('fetch', fetchMock)
    // All four queries share one result shape; per-query assertions
    // inspect the PromQL, the payload assertions use the container series
    mockPrometheus(CONTAINER_RESULT)
  })

  it('queries Prometheus with computed defaults and parses the matrix result', async () => {
    const history = await getDeploymentStatsHistory(
      { id: '5' },
      { rangeSeconds: 3600 }
    )

    expect(history.available).toBe(true)
    expect(history.rangeSeconds).toBe(3600)
    // default step: range/150, clamped to >= 15s
    expect(history.stepSeconds).toBe(24)

    const { url } = fetchMock.mock.calls[0][0] ?? {}
    expect(url).toBeUndefined() // fetch receives a URL object, not options
    const requestUrl = new URL(fetchMock.mock.calls[0][0])
    expect(requestUrl.origin).toBe(
      'http://prometheus-operated.prometheus.svc:9090'
    )
    expect(requestUrl.pathname).toBe('/api/v1/query_range')
    expect(requestUrl.searchParams.get('step')).toBe('24s')
    const start = Number(requestUrl.searchParams.get('start'))
    const end = Number(requestUrl.searchParams.get('end'))
    expect(end - start).toBe(3600)

    // One request per query: cpu, memory, volume used/capacity,
    // GPU utilization (whole-GPU + MIG profile fallback) and framebuffer
    expect(fetchMock.mock.calls).toHaveLength(7)
    const queries = fetchMock.mock.calls.map((call) =>
      new URL(call[0]).searchParams.get('query')
    )
    expect(queries[0]).toContain(
      'sum by (container, pod) (rate(container_cpu_usage_seconds_total{namespace="services",pod=~"^sd-5-\\\\d+$",container!="",container!="POD"}[240s]))'
    )
    expect(queries[1]).toContain('container_memory_working_set_bytes')
    expect(queries[2]).toContain('kubelet_volume_stats_used_bytes')
    expect(queries[2]).toContain('persistentvolumeclaim=~"^.*-sd-5-\\\\d+$"')
    expect(queries[4]).toContain(
      'max by (gpu, UUID, modelName, pod) (DCGM_FI_DEV_GPU_UTIL{pod=~"^sd-5-\\\\d+$"})'
    )
    expect(queries[5]).toContain('DCGM_FI_PROF_GR_ENGINE_ACTIVE')
    expect(queries[6]).toContain('DCGM_FI_DEV_FB_USED')

    expect(history.containers).toEqual([
      {
        name: 'nginx',
        pod: '',
        cpuCores: [
          [1794180000, 0.012],
          [1794180300, 0.014],
        ],
        memoryBytes: [
          [1794180000, 0.012],
          [1794180300, 0.014],
        ],
      },
    ])
  })

  it('keeps replica pods as separate container series', async () => {
    // sum by (container, pod): two replicas show up as two entries per
    // container instead of merging into one summed line. Entries without
    // a pod label (defensive) keep an empty pod string.
    fetchMock.mockImplementation(async (url) => {
      const query = new URL(url).searchParams.get('query')
      const isMemory = query.includes('container_memory_working_set_bytes')
      const result = isMemory
        ? [
            matrixResult('container', 'nginx', [[1794180000, 100]]),
            matrixResult('container', 'nginx', [[1794180000, 200]]),
          ].map((entry, index) => ({
            ...entry,
            metric: { ...entry.metric, pod: index === 0 ? 'sd-5-0' : 'sd-5-1' },
          }))
        : []
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: 'success',
          data: { resultType: 'matrix', result },
        }),
      }
    })

    const history = await getDeploymentStatsHistory(
      { id: '5' },
      { rangeSeconds: 3600 }
    )
    expect(history.available).toBe(true)
    expect(history.containers).toEqual([
      {
        name: 'nginx',
        pod: 'sd-5-0',
        cpuCores: [],
        memoryBytes: [[1794180000, 100]],
      },
      {
        name: 'nginx',
        pod: 'sd-5-1',
        cpuCores: [],
        memoryBytes: [[1794180000, 200]],
      },
    ])
  })

  it('pins queries to a requested pod and accepts a step override', async () => {
    await getDeploymentStatsHistory(
      { id: '5' },
      { rangeSeconds: 3600, stepSeconds: 300, podName: 'sd-5-0' }
    )
    const queries = fetchMock.mock.calls.map((call) =>
      new URL(call[0]).searchParams.get('query')
    )
    expect(queries[0]).toContain('pod=~"^sd-5-0$"')
    // rate window grows with the step
    expect(queries[0]).toContain('[300s])')
    expect(new URL(fetchMock.mock.calls[0][0]).searchParams.get('step')).toBe(
      '300s'
    )
  })

  it('parses volume series from the persistentvolumeclaim label', async () => {
    fetchMock.mockImplementation(async (url) => {
      const query = new URL(url).searchParams.get('query')
      const result = query.includes('kubelet_volume_stats') ? VOLUME_RESULT : []
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: 'success',
          data: { resultType: 'matrix', result },
        }),
      }
    })

    const history = await getDeploymentStatsHistory(
      { id: '5' },
      { rangeSeconds: 3600 }
    )
    expect(history.available).toBe(true)
    expect(history.containers).toEqual([])
    expect(history.volumes).toEqual([
      {
        name: 'mydata-sd-5-0',
        usedBytes: [[1794180000, 1048576]],
        capacityBytes: [[1794180000, 1048576]],
      },
    ])
  })

  it('reports GPU utilization and framebuffer time series per device', async () => {
    mockPrometheus([])
    // Insert GPU results for the three DCGM queries: whole-GPU
    // utilization, framebuffer memory; the profile fallback returns
    // nothing (not MIG)
    fetchMock.mockImplementation(async (url) => {
      const query = new URL(url).searchParams.get('query')
      let result = []
      if (query.includes('DCGM_FI_DEV_GPU_UTIL')) {
        result = [
          {
            metric: {
              pod: 'sd-5-0',
              gpu: '0',
              UUID: 'GPU-abc',
              modelName: 'NVIDIA A100',
            },
            values: [
              [1794180000, '85'],
              [1794180300, '91'],
            ],
          },
        ]
      } else if (query.includes('DCGM_FI_DEV_FB_USED')) {
        result = [
          {
            metric: { pod: 'sd-5-0', gpu: '0', UUID: 'GPU-abc' },
            values: [[1794180000, '4096']],
          },
        ]
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: 'success',
          data: { resultType: 'matrix', result },
        }),
      }
    })

    const history = await getDeploymentStatsHistory(
      { id: '5' },
      { rangeSeconds: 3600 }
    )
    expect(history.available).toBe(true)
    expect(history.gpuMetricsAvailable).toBe(true)
    expect(history.gpus).toEqual([
      {
        pod: 'sd-5-0',
        gpu: '0',
        uuid: 'GPU-abc',
        modelName: 'NVIDIA A100',
        utilizationPercent: [
          [1794180000, 85],
          [1794180300, 91],
        ],
        memoryBytes: [[1794180000, 4096 * 1024 ** 2]],
      },
    ])
  })

  it('derives GPU utilization from the MIG profile metric as a fallback', async () => {
    fetchMock.mockImplementation(async (url) => {
      const query = new URL(url).searchParams.get('query')
      const result = query.includes('DCGM_FI_PROF_GR_ENGINE_ACTIVE')
        ? [
            {
              metric: { pod: 'sd-5-0', gpu: '0', UUID: 'GPU-mig' },
              values: [[1794180000, '0.87']],
            },
          ]
        : []
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: 'success',
          data: { resultType: 'matrix', result },
        }),
      }
    })

    const history = await getDeploymentStatsHistory(
      { id: '5' },
      { rangeSeconds: 3600 }
    )
    expect(history.gpuMetricsAvailable).toBe(true)
    // 0.87 engine-active fraction → 87 percent
    expect(history.gpus[0].utilizationPercent).toEqual([[1794180000, 87]])
    expect(history.gpus[0].memoryBytes).toEqual([])
  })

  it('rejects invalid ranges and steps with a 400-shaped error', async () => {
    await expect(
      getDeploymentStatsHistory({ id: '5' }, { rangeSeconds: null })
    ).rejects.toMatchObject({
      statusCode: 400,
      extensions: { code: 'INVALID_PAYLOAD' },
    })
    await expect(
      getDeploymentStatsHistory({ id: '5' }, { rangeSeconds: 400 * 86400 })
    ).rejects.toMatchObject({ statusCode: 400 })
    await expect(
      getDeploymentStatsHistory(
        { id: '5' },
        { rangeSeconds: 3600, stepSeconds: 1 }
      )
    ).rejects.toMatchObject({ statusCode: 400 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('degrades when Prometheus is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('connect ECONNREFUSED'))
    const history = await getDeploymentStatsHistory(
      { id: '5' },
      { rangeSeconds: 3600 }
    )
    expect(history.available).toBe(false)
    expect(history.reason).toBe('prometheus_unavailable')
    expect(history.warnings).toHaveLength(7)
  })

  it('degrades when the Prometheus API reports an error', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ status: 'error', error: 'parse error' }),
    })
    const history = await getDeploymentStatsHistory(
      { id: '5' },
      { rangeSeconds: 3600 }
    )
    expect(history.available).toBe(false)
    expect(history.warnings[0]).toContain('parse error')
  })

  it('keeps partial results when only some queries fail', async () => {
    fetchMock.mockImplementation(async (url) => {
      const query = new URL(url).searchParams.get('query')
      if (query.includes('kubelet_volume_stats')) {
        throw new Error('volume query timed out')
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: 'success',
          data: { resultType: 'matrix', result: CONTAINER_RESULT },
        }),
      }
    })
    const history = await getDeploymentStatsHistory(
      { id: '5' },
      { rangeSeconds: 3600 }
    )
    expect(history.available).toBe(true)
    expect(history.containers[0].cpuCores).toHaveLength(2)
    expect(history.volumes).toEqual([])
    expect(history.warnings).toHaveLength(2)
    expect(history.warnings[0]).toContain('volume query timed out')
  })

  it('degrades with prometheus_not_configured when disabled', async () => {
    configState.prometheusUrl = ''
    const history = await getDeploymentStatsHistory(
      { id: '5' },
      { rangeSeconds: 3600 }
    )
    expect(history).toEqual({
      available: false,
      reason: 'prometheus_not_configured',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
