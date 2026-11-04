import { describe, expect, it } from 'vitest'

import {
  collectGpuDevices,
  gpuDeviceQueries,
  latestSample,
} from '../src/lib/gpu-metrics.js'

describe('gpuDeviceQueries', () => {
  it('builds DCGM queries scoped to the pod selector', () => {
    const queries = gpuDeviceQueries('^sd-5-\\d+$')
    expect(queries.utilization).toBe(
      'max by (gpu, UUID, modelName, pod, GPU_I_PROFILE, GPU_I_ID) (DCGM_FI_DEV_GPU_UTIL{pod=~"^sd-5-\\\\d+$"})'
    )
    expect(queries.profileUtilization).toContain(
      'DCGM_FI_PROF_GR_ENGINE_ACTIVE'
    )
    expect(queries.memory).toContain('DCGM_FI_DEV_FB_USED')
    expect(queries.memoryFree).toContain('DCGM_FI_DEV_FB_FREE')
  })

  it('escapes the selector for the PromQL string literal (regression: \\d as escape sequence)', () => {
    // PromQL parses string literals before the regex engine, so the
    // literal must contain a doubled backslash; a verbatim \d fails the
    // whole query with HTTP 400 "unknown escape sequence U+0064 'd'"
    const queries = gpuDeviceQueries('^sd-5-\\d+$')
    for (const query of Object.values(queries)) {
      expect(query).toContain('pod=~"^sd-5-\\\\d+$"')
    }
  })
})

describe('collectGpuDevices', () => {
  it('combines utilization and framebuffer series per device, MiB to bytes', () => {
    const devices = collectGpuDevices(
      [
        {
          metric: {
            pod: 'sd-5-0',
            gpu: '0',
            UUID: 'GPU-abc',
            modelName: 'A100',
          },
          values: [
            [100, '85'],
            [200, '91'],
          ],
        },
      ],
      [],
      [
        {
          metric: { pod: 'sd-5-0', gpu: '0', UUID: 'GPU-abc' },
          values: [[100, '4096']],
        },
      ]
    )
    expect(devices).toEqual([
      {
        pod: 'sd-5-0',
        gpu: '0',
        uuid: 'GPU-abc',
        gpuInstanceId: null,
        migProfile: null,
        modelName: 'A100',
        utilization: [
          [100, 85],
          [200, 91],
        ],
        memoryBytes: [[100, 4096 * 1024 ** 2]],
        // no FB_FREE data — capacity is unknown, not guessed
        capacityBytes: [],
      },
    ])
  })

  it('computes per-sample capacity from FB_USED + FB_FREE and keeps the MIG slice labels', () => {
    const devices = collectGpuDevices(
      [],
      [],
      [
        {
          metric: {
            pod: 'sd-5-0',
            gpu: '0',
            UUID: 'GPU-abc',
            GPU_I_ID: '3',
            GPU_I_PROFILE: '1g.10gb',
          },
          values: [
            [100, '2048'],
            [200, '4096'],
          ],
        },
      ],
      [
        {
          metric: {
            pod: 'sd-5-0',
            gpu: '0',
            UUID: 'GPU-abc',
            GPU_I_ID: '3',
            GPU_I_PROFILE: '1g.10gb',
          },
          values: [[100, '8192']],
        },
      ]
    )
    expect(devices[0].migProfile).toBe('1g.10gb')
    expect(devices[0].gpuInstanceId).toBe('3')
    expect(devices[0].memoryBytes).toEqual([
      [100, 2048 * 1024 ** 2],
      [200, 4096 * 1024 ** 2],
    ])
    // capacity only where used and free share a timestamp
    // (2048 MiB used + 8192 MiB free = 10 GiB slice)
    expect(devices[0].capacityBytes).toEqual([[100, 10240 * 1024 ** 2]])
  })

  it('accepts instant-query (vector) form and scales the MIG fallback ×100', () => {
    const devices = collectGpuDevices(
      [],
      [
        {
          metric: { pod: 'sd-5-0', gpu: '1', UUID: 'GPU-mig' },
          value: [100, '0.87'],
        },
      ],
      []
    )
    expect(devices).toEqual([
      {
        pod: 'sd-5-0',
        gpu: '1',
        uuid: 'GPU-mig',
        gpuInstanceId: null,
        migProfile: null,
        modelName: null,
        utilization: [[100, 87]],
        memoryBytes: [],
        capacityBytes: [],
      },
    ])
  })

  it('prefers the whole-GPU metric when both are present and tolerates missing labels', () => {
    const devices = collectGpuDevices(
      [{ metric: { gpu: '0' }, value: [100, '10'] }],
      [{ metric: { gpu: '0' }, value: [100, '0.9'] }],
      []
    )
    expect(devices[0].utilization).toEqual([[100, 10]])
    expect(devices[0]).toMatchObject({ pod: null, uuid: null })
  })

  it('sorts devices by pod, then GPU index', () => {
    const devices = collectGpuDevices(
      [
        { metric: { pod: 'sd-5-1', gpu: '1' }, value: [100, '1'] },
        { metric: { pod: 'sd-5-0', gpu: '3' }, value: [100, '2'] },
        { metric: { pod: 'sd-5-0', gpu: '2' }, value: [100, '3'] },
      ],
      [],
      [],
      []
    )
    expect(devices.map((d) => `${d.pod}/${d.gpu}`)).toEqual([
      'sd-5-0/2',
      'sd-5-0/3',
      'sd-5-1/1',
    ])
  })
})

describe('latestSample', () => {
  it('returns the last value or null for empty series', () => {
    expect(
      latestSample([
        [1, 10],
        [2, 20],
      ])
    ).toBe(20)
    expect(latestSample([])).toBeNull()
  })
})
