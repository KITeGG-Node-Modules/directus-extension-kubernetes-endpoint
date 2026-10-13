import { describe, expect, it } from 'vitest'
import { validateContainer } from '../src/lib/validate-container.js'

describe('validateContainer', () => {
  it('accepts a minimal container', () => {
    expect(
      validateContainer({ name: 'nginx', image: 'nginx:latest' })
    ).toEqual([])
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
    expect(validateContainer({ ...base, gpuCount: 8 }, [], []).length)
      .toBeGreaterThan(0)
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

  it('validates ports', () => {
    const errors = validateContainer({
      name: 'app',
      image: 'app',
      ports: [{ name: 'http', port: 0 }],
    })
    expect(errors.length).toBeGreaterThan(0)
  })
})
