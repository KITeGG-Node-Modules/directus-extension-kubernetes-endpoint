import { deleteDeployment } from '../delete-deployment.js'
import { isNotFound } from '../lib/is-not-found.js'

/**
 * Undeploys a deployment's Kubernetes resources the moment its Directus
 * item is deleted, so an item deletion is self-contained: the frontend and
 * external orchestrators (e.g. the user deletion sequence in the Keycloak
 * endpoint) can simply delete the item — the StatefulSet, services, volume
 * claims, secrets and config maps are removed here first.
 *
 * Failures abort the item deletion so nothing is left behind silently: the
 * caller sees the error and can retry. Every step of deleteDeployment is
 * idempotent (already-deleted resources are treated as success), which
 * makes the whole operation re-runnable.
 */
export default function registerHook({ filter }, context) {
	const { services, getSchema } = context

	filter('deployments.items.delete', async (keys) => {
		if (!Array.isArray(keys) || !keys.length) return keys

		const schema = await getSchema()
		const deploymentsService = new services.ItemsService('deployments', {
			schema,
			// the K8s cleanup does not depend on the requester's visibility —
			// read the items as admin so the deletion cannot be obscured
			accountability: null
		})

		const deployments = await deploymentsService.readMany(keys, {
			fields: ['id']
		})

		const errors = []
		for (const deployment of deployments) {
			try {
				await deleteDeployment(deployment)
			} catch (err) {
				// a deployment that was never deployed leaves no resources —
				// nothing to clean up, not an error
				if (!isNotFound(err)) {
					errors.push({ deployment: deployment.id, error: err })
				}
			}
		}

		if (errors.length) {
			const first = errors[0]
			throw new Error(
				`Failed to undeploy deployment ${first.deployment}: ${first.error.message}`
			)
		}

		return keys
	})
}
