import { describe, expect, it } from 'vitest'
import {
  GPU_PROFILES,
  gpuProfileToResource,
  resourceToGpuProfile,
} from '../src/lib/gpu-profiles.js'

describe('gpu profiles', () => {
  it('maps slugs to resources and back', () => {
    for (const [slug, resource] of Object.entries(GPU_PROFILES)) {
      expect(gpuProfileToResource(slug)).toBe(resource)
      expect(resourceToGpuProfile(resource)).toBe(slug)
    }
  })

  it('returns undefined for unknown values', () => {
    expect(gpuProfileToResource('gpu-xxl')).toBeUndefined()
    expect(resourceToGpuProfile('nvidia.com/mig-9g')).toBeUndefined()
  })
})
