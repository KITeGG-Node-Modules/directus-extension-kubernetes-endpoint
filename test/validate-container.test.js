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

  it('enforces IANA service name rules and port range', () => {
    const base = { name: 'app', image: 'app' }
    expect(
      validateContainer({ ...base, ports: [{ name: 'http', port: 80 }] })
    ).toEqual([])
    expect(
      validateContainer({ ...base, ports: [{ name: 'http', port: 65535 }] })
    ).toEqual([])
    // must start with a letter
    expect(
      validateContainer({ ...base, ports: [{ name: '80http', port: 80 }] })
        .length
    ).toBeGreaterThan(0)
    // no underscores, uppercase
    expect(
      validateContainer({ ...base, ports: [{ name: 'HTTP_80', port: 80 }] })
        .length
    ).toBeGreaterThan(0)
    // max 15 characters
    expect(
      validateContainer({
        ...base,
        ports: [{ name: 'a'.repeat(16), port: 80 }],
      }).length
    ).toBeGreaterThan(0)
    expect(
      validateContainer({ ...base, ports: [{ name: 'http', port: 65536 }] })
        .length
    ).toBeGreaterThan(0)
  })

  it('enforces environment variable name and key conventions', () => {
    const base = { name: 'app', image: 'app' }
    expect(
      validateContainer({
        ...base,
        environment: [{ name: 'MY_VAR', value: 'x' }],
      })
    ).toEqual([])
    // must not start with a digit, no spaces
    expect(
      validateContainer({
        ...base,
        environment: [{ name: '1VAR', value: 'x' }],
      }).length
    ).toBeGreaterThan(0)
    expect(
      validateContainer({
        ...base,
        environment: [{ name: 'MY VAR', value: 'x' }],
      }).length
    ).toBeGreaterThan(0)
    // secret/config key references follow the object key charset
    expect(
      validateContainer({
        ...base,
        environment: [{ name: 'A', fromSecret: 'valid.key-1' }],
      })
    ).toEqual([])
    expect(
      validateContainer({
        ...base,
        environment: [{ name: 'A', fromSecret: 'bad key!' }],
      }).length
    ).toBeGreaterThan(0)
    expect(
      validateContainer({
        ...base,
        environment: [{ name: 'A', fromConfig: 'bad key!' }],
      }).length
    ).toBeGreaterThan(0)
    // fromSecret and fromConfig are mutually exclusive
    expect(
      validateContainer({
        ...base,
        environment: [{ name: 'A', fromSecret: 'k', fromConfig: 'k' }],
      }).length
    ).toBeGreaterThan(0)
  })

  it('rejects non-negative-only user/group/fsUser/fsGroup', () => {
    const base = { name: 'app', image: 'app' }
    expect(validateContainer({ ...base, user: 1000, group: 1000 })).toEqual([])
    expect(validateContainer({ ...base, user: -1 }).length).toBeGreaterThan(0)
    expect(validateContainer({ ...base, fsGroup: -1 }).length).toBeGreaterThan(
      0
    )
  })

  it('rejects non-string command/args elements', () => {
    const base = { name: 'app', image: 'app' }
    expect(validateContainer({ ...base, command: ['sh', '-c'] })).toEqual([])
    expect(
      validateContainer({ ...base, command: ['sh', 1] }).length
    ).toBeGreaterThan(0)
    expect(validateContainer({ ...base, args: [null] }).length).toBeGreaterThan(
      0
    )
  })

  it('rejects duplicate mount paths within a container', () => {
    const errors = validateContainer({
      name: 'app',
      image: 'app',
      volumeMounts: [
        { name: 'data', mountPath: '/data' },
        { name: 'data', mountPath: '/data' },
      ],
    })
    expect(
      errors.some((e) => e.volumeMounts?.[0].includes('duplicate mountPath'))
    ).toBe(true)
  })

  it('caps container and volume mount name lengths at 63 characters', () => {
    const base = { image: 'app' }
    expect(validateContainer({ ...base, name: 'a'.repeat(63) })).toEqual([])
    expect(
      validateContainer({ ...base, name: 'a'.repeat(64) }).length
    ).toBeGreaterThan(0)
    expect(
      validateContainer({
        name: 'app',
        image: 'app',
        volumeMounts: [{ name: 'a'.repeat(64), mountPath: '/data' }],
      }).length
    ).toBeGreaterThan(0)
  })

  it('rejects malformed image references', () => {
    const base = { name: 'app' }
    expect(
      validateContainer({ ...base, image: 'NGINX' }).length
    ).toBeGreaterThan(0)
    expect(
      validateContainer({ ...base, image: 'nginx latest' }).length
    ).toBeGreaterThan(0)
    expect(
      validateContainer({ ...base, image: 'nginx:' }).length
    ).toBeGreaterThan(0)
    // valid shapes keep passing (allowlist separately gates registries)
    expect(validateContainer({ ...base, image: 'ubuntu@sha256:abc' })).toEqual(
      []
    )
    const registryError = validateContainer({
      ...base,
      image: 'my-reg.lan:5000/app',
    })
    expect(registryError[0].image[0]).toContain("registry 'my-reg.lan:5000'")
  })

  it('rejects a zero gpuCount', () => {
    const errors = validateContainer({
      name: 'app',
      image: 'app',
      gpu: 'nvidia.com/gpu',
      gpuCount: 0,
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
    expect(validateContainer({ ...base, runAsRoot: true })).toEqual([])
    expect(validateContainer({ ...base, runAsRoot: false })).toEqual([])
    expect(validateContainer({ ...base, seccomp: false })).toEqual([])
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
