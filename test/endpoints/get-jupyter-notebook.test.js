import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getJupyterNotebook } = vi.hoisted(() => ({
  getJupyterNotebook: vi.fn(),
}))

vi.mock('../../src/get-jupyter-notebook.js', () => ({ getJupyterNotebook }))

import { getJupyterNotebookRoute } from '../../src/endpoints/get-jupyter-notebook.js'

function createContext({ externalIdentifier = 'kc-1', keycloakUser } = {}) {
  const client = {
    get: vi.fn(async () => ({ data: keycloakUser })),
  }
  const res = { status: vi.fn() }
  return {
    ctx: {
      client,
      user: externalIdentifier
        ? { external_identifier: externalIdentifier }
        : {},
      res,
    },
    client,
    res,
  }
}

describe('getJupyterNotebookRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('resolves the JupyterHub username from the Keycloak identity', async () => {
    const { ctx, client } = createContext({
      keycloakUser: { id: 'kc-1', username: 'john' },
    })
    getJupyterNotebook.mockResolvedValue({ available: true, running: false })

    const result = await getJupyterNotebookRoute(ctx)
    expect(result).toEqual({ available: true, running: false })
    expect(client.get).toHaveBeenCalledWith('/users/kc-1')
    expect(getJupyterNotebook).toHaveBeenCalledWith('john')
  })

  it('responds 404 for users without a Keycloak identity', async () => {
    const { ctx, res } = createContext({ externalIdentifier: null })

    await getJupyterNotebookRoute(ctx)
    expect(res.status).toHaveBeenCalledWith(404)
    expect(getJupyterNotebook).not.toHaveBeenCalled()
  })

  it('responds 404 when the Keycloak user has no username', async () => {
    const { ctx, res } = createContext({ keycloakUser: { id: 'kc-1' } })

    await getJupyterNotebookRoute(ctx)
    expect(res.status).toHaveBeenCalledWith(404)
    expect(getJupyterNotebook).not.toHaveBeenCalled()
  })
})
