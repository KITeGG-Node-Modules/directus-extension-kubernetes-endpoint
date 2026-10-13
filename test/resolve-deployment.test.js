import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isDeploymentOwner,
  loadDeployment,
} from '../src/lib/resolve-deployment.js'

const USER_A = '11111111-1111-4111-8111-111111111111'
const USER_B = '22222222-2222-4222-8222-222222222222'

function makeReq(accountability = { user: USER_A }) {
  return { accountability }
}

function reqAs(userId) {
  return makeReq({ user: userId })
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('isDeploymentOwner', () => {
  it('always grants admins', () => {
    const req = makeReq({ admin: true })
    expect(isDeploymentOwner(req, { id: USER_A }, {})).toBe(true)
  })

  it('passes without enforcement (env toggle)', async () => {
    vi.stubEnv('ENFORCE_DEPLOYMENT_OWNERSHIP', 'false')
    vi.resetModules()
    const { isDeploymentOwner: unenforced } = await import(
      '../src/lib/resolve-deployment.js'
    )
    expect(
      unenforced(makeReq(), { id: USER_A }, { user_created: USER_B })
    ).toBe(true)
  })

  it('accepts user_created and user_updated', () => {
    expect(
      isDeploymentOwner(reqAs(USER_B), null, { user_created: USER_B })
    ).toBe(true)
    // expanded user objects
    expect(
      isDeploymentOwner(reqAs(USER_B), null, {
        user_created: { id: USER_B, first_name: 'A' },
      })
    ).toBe(true)
    expect(
      isDeploymentOwner(reqAs(USER_B), null, { user_updated: USER_B })
    ).toBe(true)
    expect(
      isDeploymentOwner(reqAs(USER_B), null, { user_updated: { id: USER_B } })
    ).toBe(true)
    expect(
      isDeploymentOwner(makeReq(), { id: USER_A }, { user_created: USER_B })
    ).toBe(false)
    expect(
      isDeploymentOwner(makeReq(), { id: USER_A }, { user_updated: USER_B })
    ).toBe(false)
  })

  it('accepts users from the authors M2M list', () => {
    const junctionRows = [
      { id: 1, directus_users_id: USER_B },
      { id: 2, directus_users_id: { id: USER_A } },
    ]
    const deployment = { authors: junctionRows }
    expect(isDeploymentOwner(reqAs(USER_B), null, deployment)).toBe(true)
    expect(isDeploymentOwner(reqAs(USER_A), null, deployment)).toBe(true)
    // plain user id list
    expect(isDeploymentOwner(reqAs(USER_B), null, { authors: [USER_B] })).toBe(
      true
    )
    // single non-array value
    expect(isDeploymentOwner(reqAs(USER_B), null, { authors: USER_B })).toBe(
      true
    )
    // fully expanded user as the only entry
    expect(
      isDeploymentOwner(reqAs(USER_A), null, { authors: [{ id: USER_A }] })
    ).toBe(true)
    expect(
      isDeploymentOwner(
        makeReq(),
        { id: USER_A },
        { user_created: USER_B, authors: [{ id: 5 }] }
      )
    ).toBe(false)
  })

  it('denies when no ownership field is populated', () => {
    expect(isDeploymentOwner(makeReq(), { id: USER_A }, {})).toBe(false)
    expect(
      isDeploymentOwner(
        makeReq(),
        { id: USER_A },
        { user_created: null, user_updated: null, authors: [] }
      )
    ).toBe(false)
    expect(isDeploymentOwner(makeReq({}), null, { user_created: USER_A })).toBe(
      false
    )
  })

  it('supports a custom authors field name', async () => {
    vi.stubEnv('DEPLOYMENT_AUTHORS_FIELD', 'owners')
    vi.resetModules()
    const { isDeploymentOwner: custom } = await import(
      '../src/lib/resolve-deployment.js'
    )
    expect(custom(reqAs(USER_B), null, { owners: [USER_B] })).toBe(true)
    expect(custom(reqAs(USER_B), null, { authors: [USER_B] })).toBe(false)
  })
})

describe('loadDeployment', () => {
  function makeCtx(readOne) {
    const serviceCalls = []
    const readOneCalls = []
    class FakeItemsService {
      constructor(collection, options) {
        serviceCalls.push({ collection, options })
      }
      async readOne(id, query) {
        readOneCalls.push({ id, query })
        return readOne(id, query)
      }
    }
    const ctx = {
      req: {
        params: { id: '42' },
        schema: {},
        accountability: { user: USER_A },
      },
      res: {
        status(code) {
          this.code = code
          return this
        },
      },
      services: { ItemsService: FakeItemsService },
    }
    return { ctx, serviceCalls, readOneCalls }
  }

  it('requests the ownership fields and returns the item', async () => {
    const item = { id: 42, user_created: USER_A }
    const { ctx, serviceCalls, readOneCalls } = makeCtx(() => item)
    const deployment = await loadDeployment(ctx)
    expect(deployment).toBe(item)
    expect(serviceCalls[0].collection).toBe('deployments')
    expect(serviceCalls[0].options).toEqual({
      schema: {},
      accountability: { user: USER_A },
    })
    expect(readOneCalls[0].id).toBe('42')
    expect(readOneCalls[0].query.fields).toEqual([
      '*',
      'user_created.id',
      'user_updated.id',
      'authors.directus_users_id.id',
    ])
  })

  it('sends 404 and returns null when the deployment is missing', async () => {
    const { ctx } = makeCtx(() => undefined)
    expect(await loadDeployment(ctx)).toBeNull()
    expect(ctx.res.code).toBe(404)
  })
})
