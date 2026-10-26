# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Cluster-side exception manifest `k8s/litellm-allow.yaml`: allows the `llp` and `prometheus` namespaces to reach the LiteLLM proxy of the deployment `sd-a53262dd-2d9c-44c0-83e2-e00d01cb2420` (`http://sd-a53262dd-2d9c-44c0-83e2-e00d01cb2420-litellm.services:4000`, TCP 4000). Purely additive to the ingress isolation (which would otherwise deny `llp`) and scoped to this single deployment and port — adding `llp` to `INGRESS_EXTRA_NAMESPACES` would have opened every deployment instead
- Cluster-side monitoring ingress manifest `k8s/prometheus-allow.yaml`: makes every pod in the `services` namespace reachable and discoverable from the `prometheus` namespace (all ports, namespace-wide ingress allowance) so Prometheus can scrape the entire namespace instead of the single LiteLLM target. Purely additive to the per-deployment and hardening policies; the header documents the discovery/reachability split (kubernetes_sd RBAC and CoreDNS live in the prometheus namespace) and the system-services implication
- `k8s/litellm-allow.yaml` split accordingly: renamed to `k8s/litellm-llp-allow.yaml` (LLP → LiteLLM on TCP 4000 only, unchanged in-cluster policy name `litellm-ingress-allow`); its prometheus entry is now covered namespace-wide by `k8s/prometheus-allow.yaml`. Apply the prometheus manifest before re-applying the trimmed LLP manifest to avoid a scrape gap

### Fixed

- User workloads can reach the Traefik ingress entry point again: kube-proxy DNATs connections to the public ingress IP (`134.93.175.63`, also a control-plane address) into the Traefik pod _before_ Calico evaluates the egress policy, so the destination seen by the policy is the Traefik pod IP on its pod ports (8000/8443) — cluster-internal and therefore dropped by the pod-CIDR exception. The per-deployment and hardening egress policies now allow egress to the `traefik-v2` namespace on those ports explicitly; the public-IP rule (TCP 80/443) stays for `.62` (the other cluster's ingress, no local DNAT) and keeps every other port — notably the Kubernetes API on 6443 — blocked

### Changed

- Containers run as non-root by default again: the pod is rejected at admission when an image's default user is root; images whose entrypoint needs root opt out per container with `runAsRoot: true`, and an explicit `user`/`group` overrides the image default regardless. The interim `runAsNonRoot` opt-in key (from the root-by-default change) is removed — validation rejects it again, so deployments still carrying it must drop the key on their next edit. Combined with the Docker default capability grant this restores the plain-Docker security posture for non-root images while keeping root-default images deployable only through an explicit, auditable `runAsRoot: true`
- Containers get the full Docker/containerd default capability set back implicitly: hardening still drops ALL Linux capabilities, but the default grant is now the complete Docker default set (`CHOWN`, `SETGID`, `SETUID`, `DAC_OVERRIDE`, `NET_BIND_SERVICE`, `NET_RAW`, …) instead of only `NET_BIND_SERVICE` — the previous grant rejected standard images at startup that were built for plain Docker, e.g. the official nginx image crash-looped on `chown("/var/cache/nginx/client_temp", 101) failed (1: Operation not permitted)`. Everything beyond the Docker default set (`SYS_ADMIN`, `NET_ADMIN`, `SYS_PTRACE`, …) stays unavailable; the per-container `capabilities` field remains for extras an admin adds to `ALLOWED_CAPABILITIES` (no-op duplicates of the implicit grant are now deduplicated). Applies on the next redeploy; running pods are never restarted by the change
- Containers run as root by default again: the forced `runAsNonRoot: true` rejected most images at admission (`container has runAsNonRoot and image will run as root`) because they ship a root default user. Non-root is now a per-container opt-in (`runAsNonRoot: true` in the deployment YAML, validated as boolean). Deployments written for the old scheme keep working unchanged: `runAsRoot: true` still runs as root and `runAsRoot: false` still keeps the non-root default it affirmed. Applies on the next redeploy; running pods are never restarted by the change. An explicit `user`/`group` still overrides the image default regardless
- Deleting a `deployments` item now undeploys its cluster resources first: a bundled hook (`src/hooks/undeploy-on-delete.js`) listens for `deployments.items.delete` and runs the same idempotent cleanup as the undeploy endpoint (StatefulSet, services, volume claims including unlabeled ones, secrets, config maps, NetworkPolicy), aborting the deletion when the cleanup fails so nothing is left behind silently and a failed deletion can simply be retried. Item deletion is therefore self-contained — callers no longer need to undeploy separately first (the frontend delete dialog used to, and child deployments removed through the decouple/delete flow leaked their resources entirely). The undeploy endpoint itself stays for stopping a service without deleting its item; the shared 404 check was extracted to `src/lib/is-not-found.js`
- The deployment `status` no longer affects network access: `draft` (and every other state) is now reachable exactly like a published deployment — via the proxy/ingress path on the deployment's declared service ports, by other user deployments, and from the extra ingress namespaces. The `status` now only controls visibility in the services overview

### Removed

- The same-owner peer rules and the published-port carve-out in the per-deployment NetworkPolicies (both subsumed by the general ingress rules now that drafts are unrestricted)
- The `DEPLOYMENT_PUBLIC_STATUSES` configuration and the owner-group resync machinery (`syncOwnerGroup`, per-deployment peer lists): the policies depend only on each deployment's own item (id and declared ports), so syncing the edited items is sufficient

## [2.0.0] - 2026-10-19

### Added

- Network isolation for user deployments via per-deployment NetworkPolicies, created and replaced with every deploy and selected by the deployment's `app` label, so existing deployments are isolated without any pod template change and without restarting anything
- Ingress rules per deployment: replicas may talk to each other on any port; deployments of the same owners (`user_created` / `authors`) and — for public deployments — the ingress path (Traefik, the oauth2-proxy `service-proxy`), the Open WebUI instances, the extra ingress namespaces (`INGRESS_EXTRA_NAMESPACES`, default `jupyterhub`) and other user deployments may connect on the deployment's declared service ports only. A published port (`exposed_service` / `exposed_port`) is reachable by the ingress path and by the Open WebUI instances regardless of the deployment's visibility or access control — the published port is the only requirement
- Directus hook (`src/hooks/sync-deployments.js`, shipped via the extension bundle): access-control edits on `deployments` items (status, owners, published port, declared ports) regenerate the affected NetworkPolicies without waiting for the next deploy; deleting an item directly triggers a full sync, and a scheduled reconciliation (`*/10 * * * *`) runs a full sync as a safety net for junction-level author changes and out-of-band edits. The extension is now a bundle (endpoint + hook entries)
- Container hardening on every deployment (applies on the next redeploy, no forced restart): service account tokens are no longer mounted into pods, containers get the `RuntimeDefault` seccomp profile and drop ALL Linux capabilities beyond the Docker/containerd default set (with `NET_BIND_SERVICE` granted implicitly so images serving on low ports keep working), and containers run as non-root by default. Per-container opt-outs in the deployment YAML: `runAsRoot: true`, `seccomp: false`, `capabilities: [...]`
- Deployment status now exposes, per container and init container, the Kubernetes waiting `reason`/`message`, `restartCount` and the last termination (`reason`/`exitCode`) — pre-start failures such as the `runAsNonRoot` rejection are visible durably (events expire after ~1h and a container that never started has no logs to inspect)
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
- Cluster-side hardening manifests in `k8s/` (applied by admins, independent of the extension): Pod Security Admission staging for the namespace (`pod-security.yaml`), ResourceQuota + LimitRange bounding total namespace compute and object counts (`resource-quota.yaml`), and ingress protection for the system-internal services with the verified traffic matrix (`system-services-policy.yaml`) — closing the cluster-wide path to the oauth2-proxy session store and the ingress path from other namespaces
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

- Re-deploying a deployment whose pod never became Ready now actually reaches the pod: the StatefulSet controller's `OrderedReady` rolling update records the new revision but never rolls a pod stuck in `CreateContainerConfigError`, `CrashLoopBackOff` or `Pending` — the pod kept running the old template forever while every re-deploy looked like a no-op (no pod kill, no events). The deploy endpoint now deletes not-ready pods of an existing StatefulSet after the update, so the controller recreates them from the current template immediately; ready pods are left to the controller's normal rolling update
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
