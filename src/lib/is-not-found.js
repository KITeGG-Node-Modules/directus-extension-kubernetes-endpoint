// Kubernetes client errors carry the HTTP status both as `statusCode`
// (client-node Error) and as `body.code` (the API error body) — the 404
// case means the resource is already gone and every cleanup step treats
// it as success
export function isNotFound(err) {
	return err?.statusCode === 404 || err?.body?.code === 404
}
