# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Network isolation for user deployments via per-deployment NetworkPolicies, created and replaced with every deploy and selected by the deployment's `app` label, so existing deployments are isolated without any pod template change and without restarting anything
- Ingress rules per deployment: replicas may talk to each other on any port; deployments of the same owners (`user_created` / `authors`) and — for public deployments — the ingress path (Traefik, the oauth2-proxy `service-proxy`), the Open WebUI instances, the extra ingress namespaces (`INGRESS_EXTRA_NAMESPACES`, default `jupyterhub`) and other user deployments may connect on the deployment's declared service ports only. A published port (`exposed_service` / `exposed_port`) is reachable by the ingress path and by the Open WebUI instances regardless of the deployment's visibility or access control — the published port is the only requirement
- Directus hook (`src/hooks/sync-deployments.js`, shipped via the extension bundle): access-control edits on `deployments` items (status, owners, published port, declared ports) regenerate the affected NetworkPolicies without waiting for the next deploy; deleting an item directly triggers a full sync, and a scheduled reconciliation (`*/10 * * * *`) runs a full sync as a safety net for junction-level author changes and out-of-band edits. The extension is now a bundle (endpoint + hook entries)
- Container hardening on every deployment (applies on the next redeploy, no forced restart): service account tokens are no longer mounted into pods, containers get the `RuntimeDefault` seccomp profile and drop ALL Linux capabilities beyond the Docker/containerd default set (with `NET_BIND_SERVICE` granted implicitly so images serving on low ports keep working), and containers run as non-root by default. Per-container opt-outs in the deployment YAML: `runAsRoot: true`, `seccomp: false`, `capabilities: [...]`
- Image registry allowlist for user containers (`IMAGE_REGISTRY_ALLOWLIST` env, default: docker.io, ghcr.io, quay.io, nvcr.io, mcr.microsoft.com, registry.kitegg.de, registry.motionbank.org; `*` disables the check) — bare image names resolve to docker.io per the Docker reference rules
- Egress rules per deployment: DNS, other user deployments' pods and the public internet only; the cluster-internal ranges (pods and services of any namespace, node networks) and the Kubernetes API — including its public control-plane addresses — are blocked explicitly
- Headless service per deployment (`sd-<id>`), backing cross-deployment DNS (`sd-<id>.services.svc.cluster.local` resolves to the pod IPs) and the StatefulSet's `serviceName`
- `POST /network-policies/backfill` admin endpoint: idempotently creates or updates the isolation resources (NetworkPolicy + headless service) of every deployment without touching any pod, used for the zero-downtime migration of existing deployments and after changing `SYSTEM_APP_LABEL_VALUES`
- Cluster-level hardening manifest `k8s/network-policy.yaml` (admin-owned second line of defense: ingress default-deny and the same egress guardrails for every pod whose `app` label is not one of the system-internal services — previously existing pods included), pre-filled with the cluster's verified CIDRs
- `networkpolicies` RBAC for the extension's account in `k8s/rbac.yaml`
- Configuration: `DEPLOYMENT_PUBLIC_STATUSES` (deployment statuses that are publicly reachable, default `published`) and `INGRESS_EXTRA_NAMESPACES` (namespaces whose pods may reach public deployments, default `jupyterhub`)
- `GET /deployments-running` endpoint listing the ids of deployments that currently have pods in the Running state
- Deployment ownership enforcement on all mutating endpoints: non-admin users can only scale, restart, delete, or change the secret and config of deployments they own. Ownership derives from the deployment's `user_created`, `user_updated` and `authors` fields; `DEPLOYMENT_AUTHORS_FIELD` configures the authors list (an empty value disables that source) and `ENFORCE_DEPLOYMENT_OWNERSHIP=false` disables the check entirely
- Required Kubernetes RBAC documented, with a ready-to-apply `k8s/rbac.yaml` manifest
- Test suite (Vitest), ESLint and CI
- Licensed under the EUPL, Version 1.2

### Changed

- Kubernetes resource creation is now race-tolerant and upserts resources that already exist
- Created resources are labeled and cleaned up by selector on delete
- Containers always get CPU and memory limits set
- Cluster capacity requests accept capacities as numbers or Kubernetes quantity strings
- API error responses are normalized
- The built `dist/index.js` is tracked in the repository so the extension can be installed directly from GitHub

### Fixed

- Kubernetes client cache returning the wrong API client after bundling
- Extension build output to `dist/index.js`
- Pod-level security context type
- Kubernetes quantity parsing in cluster capacity reporting
- Cluster capacity accounting for containers that specify limits only
- Scale query parameter is validated against the replica bounds before use
- Deployment data is parsed before reservation checks, so invalid YAML returns a client error instead of an unhandled 500
- Deployment loading dropped the deployment id by requesting ownership fields only, so every stateful set lookup failed with `statefulsets.apps "sd-undefined" not found`
- Re-deploying a deployment with volumes failed with a Kubernetes `422` (`field is immutable`): the immutable volume claim templates of the existing stateful set are now preserved on update, and adding volumes to an existing deployment returns a client error instead
- Volume claims created before the deployment label was introduced are labeled on re-deploy and matched by claim name on delete, so they are no longer missing from the deployment status and no longer leak their data on delete
- Scaling a deployment to 0 was rejected when the GPU reservations no longer covered its demand: scaling to zero frees resources, so it now skips the reservation check and is always possible
- Restarting a deployment and deleting one of its pods were rejected when the GPU reservations no longer covered the deployment's demand: neither operation changes the GPU demand, so they no longer run the reservation check
- Reservation checks computed the GPU demand from the replica count stored in the deployment data instead of the requested scale: the stored count is not updated by scaling, so scaling up could exceed the reserved GPUs

### Security

- Pod logs, events and deletion are restricted to pods belonging to the deployment itself
- User workloads are network-isolated: they cannot reach system-internal services sharing the services namespace, pods or services of any other namespace, node networks, or the Kubernetes API; draft/restricted deployments are only reachable by deployments of the same owners, and public deployments only on their declared service ports
