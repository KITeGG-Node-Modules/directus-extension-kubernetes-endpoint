import { backfillNetworkPolicies } from '../sync-network-policies.js'
import { handleErrorResponse } from '../lib/util.js'

/**
 * POST /kubernetes/network-policies/backfill
 *
 * Administrator-only, idempotent migration endpoint: creates or updates
 * the per-deployment isolation resources (NetworkPolicy + headless
 * service) of EVERY deployment. Nothing here touches pods, so no running
 * deployment is restarted — this is how the isolation is rolled out over
 * existing deployments without contacting their users.
 *
 * Run it once after the RBAC includes networkpolicies, and again whenever
 * SYSTEM_APP_LABEL_VALUES changes (a new system-internal service in the
 * namespace must be excluded from the user-pod selectors).
 */
export async function backfillNetworkPoliciesRoute(ctx) {
  const { req, res, services } = ctx
  if (!req.accountability?.admin) {
    res.status(403)
    return { message: 'api_errors.forbidden' }
  }
  try {
    const summary = await backfillNetworkPolicies(services, req.schema)
    return {
      synced: summary.policies,
      headlessServices: summary.headlessServices,
    }
  } catch (err) {
    return handleErrorResponse(res, err)
  }
}
