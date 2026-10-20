import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import registerHook from '../../src/hooks/sync-deployments.js'

const { syncDeploymentIds, backfillNetworkPolicies } = vi.hoisted(() => ({
  syncDeploymentIds: vi.fn(),
  backfillNetworkPolicies: vi.fn(),
}))

vi.mock('../../src/sync-network-policies.js', () => ({
  syncDeploymentIds,
  backfillNetworkPolicies,
}))

const context = {
  services: {},
  getSchema: vi.fn(async () => ({ some: 'schema' })),
}

function register() {
  const api = {
    action: vi.fn(),
    schedule: vi.fn(),
    filter: vi.fn(),
    init: vi.fn(),
  }
  registerHook(api, context)
  return api
}

function actionHandler(api, event) {
  const handler = api.action.mock.calls.find(([e]) => e === event)?.[1]
  expect(handler, `no action handler registered for ${event}`).toBeDefined()
  return handler
}

describe('sync-deployments hook', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    syncDeploymentIds.mockResolvedValue({ policies: 1 })
    backfillNetworkPolicies.mockResolvedValue({ policies: 1 })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('registers update/create actions and a schedule', () => {
    const api = register()
    expect(api.action.mock.calls.map(([event]) => event)).toEqual([
      'deployments.items.update',
      'deployments.items.create',
    ])
    expect(api.schedule.mock.calls[0][0]).toBe('*/10 * * * *')
  })

  it('debounces item updates into one targeted sync', async () => {
    const api = register()
    actionHandler(api, 'deployments.items.update')({ keys: ['5'] })
    actionHandler(api, 'deployments.items.update')({ keys: [7] })
    await vi.advanceTimersByTimeAsync(2000)
    expect(syncDeploymentIds).toHaveBeenCalledTimes(1)
    expect(syncDeploymentIds).toHaveBeenCalledWith(context.services, { some: 'schema' }, ['5', '7'])
    expect(backfillNetworkPolicies).not.toHaveBeenCalled()
  })

  it('syncs targeted on create', async () => {
    const api = register()
    actionHandler(api, 'deployments.items.create')({ key: 'abc' })
    await vi.advanceTimersByTimeAsync(2000)
    expect(syncDeploymentIds).toHaveBeenCalledWith(context.services, { some: 'schema' }, ['abc'])
  })

  it('runs the scheduled reconciliation as a full sync', async () => {
    const api = register()
    const handler = api.schedule.mock.calls[0][1]
    await handler()
    await vi.advanceTimersByTimeAsync(2000)
    expect(backfillNetworkPolicies).toHaveBeenCalledTimes(1)
  })

  it('never fails the mutation when the sync errors', async () => {
    syncDeploymentIds.mockRejectedValue(new Error('k8s down'))
    const api = register()
    actionHandler(api, 'deployments.items.update')({ keys: ['5'] })
    // An unhandled rejection would fail this test
    await vi.advanceTimersByTimeAsync(2000)
    expect(syncDeploymentIds).toHaveBeenCalledTimes(1)
  })
})
