import { describe, expect, it, vi } from 'vitest'
import { upsert } from '../src/lib/upsert.js'

const ok = () => Promise.resolve({})
const notFound = () => Promise.reject({ statusCode: 404 })
const conflict = () => Promise.reject({ statusCode: 409 })

describe('upsert', () => {
  it('creates when the resource does not exist', async () => {
    const read = vi.fn(notFound)
    const create = vi.fn(ok)
    const update = vi.fn(ok)
    const result = await upsert({ read, create, update })
    expect(result).toEqual({ created: true })
    expect(create).toHaveBeenCalledTimes(1)
    expect(update).not.toHaveBeenCalled()
  })

  it('passes the read result to the update callback', async () => {
    const current = { body: { spec: {} } }
    const read = vi.fn(() => Promise.resolve(current))
    const create = vi.fn()
    const update = vi.fn(ok)
    const result = await upsert({ read, create, update })
    expect(result).toEqual({ created: false })
    expect(create).not.toHaveBeenCalled()
    expect(update).toHaveBeenCalledWith(current)
  })

  it('passes null to the update callback when the create race was lost', async () => {
    const read = vi.fn(notFound)
    const create = vi.fn(conflict)
    const update = vi.fn(ok)
    const result = await upsert({ read, create, update })
    expect(result).toEqual({ created: false })
    expect(update).toHaveBeenCalledWith(null)
  })

  it('re-throws read errors other than 404', async () => {
    const err = { statusCode: 500 }
    await expect(
      upsert({
        read: () => Promise.reject(err),
        create: vi.fn(),
        update: vi.fn(),
      })
    ).rejects.toBe(err)
  })

  it('re-throws create errors other than 409', async () => {
    const err = { statusCode: 422 }
    await expect(
      upsert({
        read: vi.fn(notFound),
        create: () => Promise.reject(err),
        update: vi.fn(),
      })
    ).rejects.toBe(err)
  })
})