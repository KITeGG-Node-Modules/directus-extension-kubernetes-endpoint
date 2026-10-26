import { describe, expect, it } from 'vitest'
import {
  imageRegistry,
  validateContainer,
} from '../src/lib/validate-container.js'

describe('validateContainer', () => {
  it('accepts a minimal container', () => {
    expect(validateContainer({ name: 'nginx', image: 'nginx:latest' })).toEqual(
      []
    )
  })

  it('rejects invalid gpu resources', () => {
    const errors = validateContainer({
      name: 'app',
      image: 'app',
      gpu: 'nvidia.com/mig-9g',
    })
    expect(errors.length).toBeGreaterThan(0)
  })

  it('caps gpuCount by group membership', () => {
    const base = { name: 'app', image: 'app', gpu: 'nvidia.com/gpu' }
    expect(validateContainer({ ...base, gpuCount: 2 })).toEqual([])
    expect(
      validateContainer({ ...base, gpuCount: 8 }, [], []).length
    ).toBeGreaterThan(0)
    expect(
      validateContainer({ ...base, gpuCount: 8 }, [], [{ name: 'management' }])
    ).toEqual([])
  })

  it('requires memory of at least 1', () => {
    const errors = validateContainer({
      name: 'app',
      image: 'app',
      memory: 0.5,
    })
    expect(errors.length).toBeGreaterThan(0)
  })

  it('accepts capacity values as numbers or quantity strings', () => {
    const base = { name: 'app', image: 'app' }
    expect(validateContainer({ ...base, cpu: 8, memory: 2 })).toEqual([])
    expect(validateContainer({ ...base, cpu: '8', memory: '2' })).toEqual([])
    expect(validateContainer({ ...base, cpu: '1500m', memory: '2Gi' })).toEqual(
      []
    )
    expect(validateContainer({ ...base, cpu: '2', memory: '1536Mi' })).toEqual(
      []
    )
  })

  it('rejects quantity strings outside the capacity bounds', () => {
    const base = { name: 'app', image: 'app' }
    expect(validateContainer({ ...base, cpu: '1500' }).length).toBeGreaterThan(
      0
    ) // 1500 cores > 32
    expect(
      validateContainer({ ...base, memory: '512Mi' }).length
    ).toBeGreaterThan(0) // 0.5 GiB < 1
    expect(
      validateContainer({ ...base, memory: '200Gi' }).length
    ).toBeGreaterThan(0) // > 128
    expect(validateContainer({ ...base, cpu: 1.5 }).length).toBeGreaterThan(0) // numeric cpu stays whole-cores-only
  })

  it('rejects unparseable capacity strings', () => {
    const base = { name: 'app', image: 'app' }
    expect(validateContainer({ ...base, cpu: 'abc' }).length).toBeGreaterThan(0)
    expect(
      validateContainer({ ...base, memory: '2GiGi' }).length
    ).toBeGreaterThan(0)
  })

  it('caps quantity strings by group membership', () => {
    const base = { name: 'app', image: 'app', cpu: '256', memory: '512Gi' }
    expect(validateContainer({ ...base }, [], []).length).toBeGreaterThan(0)
    expect(
      validateContainer({ ...base }, [], [{ name: 'management' }])
    ).toEqual([])
  })

  it('validates ports', () => {
    const errors = validateContainer({
      name: 'app',
      image: 'app',
      ports: [{ name: 'http', port: 0 }],
    })
    expect(errors.length).toBeGreaterThan(0)
  })

  it('accepts images from the default registries and bare names', () => {
    const base = { name: 'app' }
    expect(
      validateContainer({ ...base, image: 'pytorch/pytorch:latest' })
    ).toEqual([]) // docker.io
    expect(validateContainer({ ...base, image: 'nginx' })).toEqual([]) // docker.io
    expect(
      validateContainer({ ...base, image: 'nvcr.io/nvidia/cuda:12' })
    ).toEqual([])
    expect(
      validateContainer({ ...base, image: 'registry.kitegg.de/models/vllm' })
    ).toEqual([])
    expect(
      validateContainer({ ...base, image: 'registry.motionbank.org/app:1' })
    ).toEqual([])
    expect(validateContainer({ ...base, image: 'ghcr.io/owner/repo' })).toEqual(
      []
    )
  })

  it('rejects images from unknown registries, listing the allowlist', () => {
    const errors = validateContainer({
      name: 'app',
      image: 'evil.example.net/miner:latest',
    })
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0].image[0]).toContain('evil.example.net')
    expect(errors[0].image[0]).toContain('registry.kitegg.de')
  })

  it('accepts whitelisted capabilities and rejects others', () => {
    const base = { name: 'app', image: 'app' }
    expect(
      validateContainer({ ...base, capabilities: ['NET_BIND_SERVICE'] })
    ).toEqual([])
    expect(
      validateContainer({ ...base, capabilities: ['SYS_ADMIN'] }).length
    ).toBeGreaterThan(0)
    expect(
      validateContainer({ ...base, capabilities: 'NET_BIND_SERVICE' }).length
    ).toBeGreaterThan(0)
  })

  it('rejects non-boolean hardening flags', () => {
    const base = { name: 'app', image: 'app' }
    expect(validateContainer({ ...base, runAsNonRoot: true })).toEqual([])
    expect(validateContainer({ ...base, runAsRoot: true })).toEqual([])
    expect(validateContainer({ ...base, runAsRoot: false })).toEqual([])
    expect(validateContainer({ ...base, seccomp: false })).toEqual([])
    expect(
      validateContainer({ ...base, runAsNonRoot: 'yes' }).length
    ).toBeGreaterThan(0)
    expect(
      validateContainer({ ...base, runAsRoot: 'yes' }).length
    ).toBeGreaterThan(0)
    expect(
      validateContainer({ ...base, seccomp: 'no' }).length
    ).toBeGreaterThan(0)
  })
})

describe('imageRegistry', () => {
  it('resolves registries per the Docker reference rules', () => {
    expect(imageRegistry('pytorch/pytorch:latest')).toBe('docker.io')
    expect(imageRegistry('nginx')).toBe('docker.io')
    expect(imageRegistry('ubuntu@sha256:abc')).toBe('docker.io')
    expect(imageRegistry('nvcr.io/nvidia/cuda')).toBe('nvcr.io')
    expect(imageRegistry('my-reg.lan:5000/app')).toBe('my-reg.lan:5000')
    expect(imageRegistry('localhost/app')).toBe('localhost')
    expect(imageRegistry(null)).toBe(null)
  })
})
