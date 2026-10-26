import { beforeEach, describe, expect, it, vi } from 'vitest'
import registerHook from '../../src/hooks/undeploy-on-delete.js'

const { deleteDeployment, readMany, newItemService } = vi.hoisted(() => ({
  deleteDeployment: vi.fn(),
  readMany: vi.fn(),
  newItemService: vi.fn(),
}))

vi.mock('../../src/delete-deployment.js', () => ({ deleteDeployment }))

class ItemsServiceMock {
  constructor(collection, options) {
    newItemService(collection, options)
  }
  async readMany(keys, query) {
    return readMany(keys, query)
  }
}

const context = {
  services: { ItemsService: ItemsServiceMock },
  getSchema: vi.fn(async () => ({ some: 'schema' })),
}

function register() {
  const api = { action: vi.fn(), schedule: vi.fn(), filter: vi.fn(), init: vi.fn() }
  registerHook(api, context)
  return api
}

function filterHandler() {
  const api = register()
  const handler = api.filter.mock.calls.find(([e]) => e === 'deployments.items.delete')?.[1]
  expect(handler, 'no filter handler registered for deployments.items.delete').toBeDefined()
  return handler
}

describe('undeploy-on-delete hook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    deleteDeployment.mockResolvedValue(undefined)
    readMany.mockImplementation(async (keys) =>
      keys.map((id) => ({ id, slug: `slug-${id}` }))
    )
  })

  it('undeploys every deleted deployment and passes the keys through', async () => {
    const handler = filterHandler()
    const keys = ['id-1', 'id-2']

    const result = await handler(keys)

    expect(result).toBe(keys)
    expect(deleteDeployment).toHaveBeenCalledTimes(2)
    expect(deleteDeployment).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'id-1' })
    )
    expect(deleteDeployment).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'id-2' })
    )
  })

  it('reads the items with the deletion fields only and null accountability', async () => {
    const handler = filterHandler()

    await handler(['id-1'])

    expect(newItemService).toHaveBeenCalledWith('deployments', {
      schema: { some: 'schema' },
      accountability: null,
    })
    expect(readMany).toHaveBeenCalledWith(['id-1'], { fields: ['id'] })
  })

  it('aborts the item deletion when undeploying fails', async () => {
    const handler = filterHandler()
    deleteDeployment.mockRejectedValueOnce(new Error('k8s unreachable'))

    await expect(handler(['id-1', 'id-2'])).rejects.toThrow(
      'Failed to undeploy deployment id-1: k8s unreachable'
    )
  })

  it('passes through without any lookup when there is nothing to delete', async () => {
    const handler = filterHandler()

    expect(await handler([])).toEqual([])
    expect(await handler(null)).toBeNull()
    expect(deleteDeployment).not.toHaveBeenCalled()
    expect(readMany).not.toHaveBeenCalled()
  })
})
