# KITeGG Kubernetes Endpoint

> K8S control interface for the LLP

## Services Endpoints

### Deploying a service

First, the service needs to be created in the collection `deployments` in the LLP API.

### Authorization

Mutating endpoints (deploying, restarting, scaling, deleting, secrets and
configs) verify that the requesting user owns the deployment before
performing any operation; admins always have access. Requests from other
users are rejected with `403`.

A user owns a deployment when any of the following match their user id:

- the deployment's `user_created` field (who created the item),
- the deployment's `user_updated` field (who last modified the item), or
- the deployment's `authors` M2M list of users who have rights on the
  deployment (junction rows exposing the user as `directus_users_id`;
  set `DEPLOYMENT_AUTHORS_FIELD` to use a different field name, or an
  empty value to skip this source).

- Set `ENFORCE_DEPLOYMENT_OWNERSHIP=false` to disable ownership enforcement
  (not recommended for production).

Pod-scoped endpoints (logs, events, pod deletion) additionally verify that
the requested pod actually belongs to the deployment; requests for foreign
or non-existent pods return `404`.

### Required Kubernetes RBAC

The extension performs every Kubernetes call with the credentials from
`K8S_USER_TOKEN`, so that account must be allowed to read **and write** the
extension's resources in the services namespace (`SERVICES_NAMESPACE`,
default `services`). A ready-to-apply manifest is provided in
[`k8s/rbac.yaml`](k8s/rbac.yaml).

Required verbs per resource (within the services namespace):

| Resource                            | Verbs                                                | Used by                                                                  |
| ----------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------ |
| `apps/statefulsets`                 | `get`, `list`, `create`, `update`, `patch`, `delete` | deploy, re-deploy (`update`), restart hook (`patch`), state/info, delete |
| `apps/statefulsets/scale`           | `update`, `patch`                                    | scaling (`PATCH /deployments/:id?scale=…`)                               |
| `services`                          | `get`, `create`, `patch`                             | deploy (ports of an existing service are patched)                        |
| `networking.k8s.io/networkpolicies` | `get`, `list`, `create`, `update`, `delete`          | deploy (per-deployment ingress policy), delete                           |
| `configmaps`                        | `get`, `create`, `update`, `delete`                  | config endpoints, delete                                                 |
| `secrets`                           | `get`, `create`, `update`, `delete`                  | secret endpoints, delete                                                 |
| `persistentvolumeclaims`            | `list`, `delete`                                     | deployment info, delete                                                  |
| `pods`                              | `list`, `delete`                                     | state/info/logs/events, delete pod                                       |
| `pods/log`                          | `get`                                                | pod logs                                                                 |
| `events.k8s.io/events`              | `get`, `list`                                        | pod events                                                               |

> **Note:** verbs are evaluated per resource; permissions on `statefulsets`
> do **not** imply permissions on the `statefulsets/scale` subresource. A
> role that only grants read/create therefore still fails with `403` for
> scaling, restarting, re-deploying existing services, secret/config
> updates and deletion — while first-time deploys and all read endpoints
> keep working.

Additionally, `GET /kubernetes/capacity` reads cluster-scoped resources
(nodes and pods across all namespaces) and needs a `ClusterRole` (included
in `k8s/rbac.yaml`).

### Network isolation

Deployed services are the least trusted workloads in the cluster. Isolation
is enforced by per-deployment NetworkPolicies that the extension creates
for every deployment (requires a CNI that enforces NetworkPolicy — this
cluster uses Calico). The policies select pods by the deployment's
`app: sd-<id>` label, which is present on every pod — including those of
deployments deployed before the isolation rollout. Applying the policies
therefore never changes a pod template and never restarts anything.

Each deployment's policy enforces:

- **Ingress:**

  - replicas of the deployment itself (any port),
  - **the ingress path** (Traefik in `traefik-v2` for direct routes, and
    the oauth2-proxy `service-proxy` pods fronting
    `*.service.kitegg.hs-mainz.de`), on the deployment's **declared
    service ports** only,
  - the **extra ingress namespaces** (`INGRESS_EXTRA_NAMESPACES`, default
    `jupyterhub` — the hub and user notebooks reach published services
    directly), the **Open WebUI instances** (`INGRESS_SYSTEM_POD_LABELS`)
    and **other user deployments** — also on the declared ports only.

  The Directus `status` of a deployment (e.g. `draft`) does not
  participate in the policies: it only controls visibility in the
  services overview, not network access.

  The wildcard domain has TWO entry points, and both work unchanged: the
  Traefik route above, and the NGINX TLS proxy (NodePort `:30443`, TLS
  termination) which forwards to the same `service-proxy` pods. Neither
  NGINX nor the service-proxy are policy-selected, so their hops are
  unrestricted; the only hop governed by policy is `service-proxy` → user
  pod, which is the allowed ingress-path peer. If NGINX ever proxied to
  user services directly (not via the service-proxy), it would need to be
  added to that peer rule.

- **Egress:** DNS, other user deployments' pods, and the public internet.
  System-internal services in the namespace (`cache`, `nginx`,
  `openwebui*`, `service-proxy`, `tty-server`), pods and services of any
  other namespace, node networks and the Kubernetes API are unreachable —
  including the public control-plane addresses (`134.93.175.62/.63`),
  which are blocked explicitly. Exceptions for the ingress path only: the
  public addresses are reachable on the web ports (TCP 80/443), and the
  Traefik pods (namespace `traefik-v2`) on their entrypoint ports
  (TCP 8000/8443) — kube-proxy DNATs connections to the public ingress IP
  into the Traefik pod _before_ the egress policy is evaluated, so the
  namespace rule is what actually carries that traffic. Every other port
  (notably the Kubernetes API on 6443) stays blocked on those addresses.

The Directus `status` of the `deployments` collection does not affect
network access (see [Network isolation](#network-isolation)): every
deployment is reachable from the ingress path on its declared service
ports, and other user deployments can connect via the headless service
`sd-<id>.services.svc.cluster.local`, which resolves to the pod IPs
(ClusterIPs are unreachable by the egress rules). The `status` only
controls visibility in the services overview. Undeclared ports
(admin interfaces, debug endpoints) are never reachable from outside the
deployment's replicas.

**Keeping the policies in sync:** the policies are regenerated whenever a
deployment is **deployed** via the extension endpoints, and — via the
bundled Directus hook (`src/hooks/sync-deployments.js`) — whenever a
`deployments` item is changed in Directus, so edits are reflected without
waiting for the next deploy:

- Port changes in the deployment YAML trigger a debounced sync of exactly
  the edited deployments (each policy depends only on its own item).
- A scheduled reconciliation (`*/10 * * * *`) runs a full sync as a
  safety net for everything the item hooks cannot see — out-of-band
  `kubectl` edits, drift.
- `POST /kubernetes/network-policies/backfill` remains the manual
  fallback (e.g. after cluster restores or as part of the rollout).

None of these paths require contacting users or re-deploying existing
deployments — policies select pods by the universal `app` label and apply
without touching a pod.

**Static hardening layer** ([`k8s/network-policy.yaml`](k8s/network-policy.yaml),
applied once by a cluster administrator): a second, admin-owned line of
defense selecting every pod in the namespace whose `app` label is not one
of the system-internal services — i.e. exactly the user workloads,
previously existing pods included (pods without an `app` label, such as
the kuberay-operator with its `app.kubernetes.io/*` labels, are not
selected). Ingress default-deny plus the same egress guardrails. If the
extension's account were compromised, its per-deployment policies could
be rewritten; these policies could not. MAINTENANCE: keep the manifest's
`NotIn` list in sync with `SYSTEM_APP_LABEL_VALUES`.

**Rollout / migration** (no user interaction, no interruptions — policies
are applied without touching any pod):

1. Apply `k8s/rbac.yaml` (adds `networkpolicies` verbs) and deploy the new
   extension version.
2. Run the backfill as an administrator — it creates the per-deployment
   policy and headless service for every existing deployment and is
   idempotent:

   ```sh
   curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
     https://<directus>/kubernetes/network-policies/backfill
   ```

3. Apply the static hardening manifest:

   ```sh
   kubectl apply -f k8s/rbac.yaml
   kubectl apply -f k8s/network-policy.yaml
   ```

4. Verify, e.g.:

   ```sh
   kubectl get networkpolicies -n services | head
   kubectl get pods -n services -o wide   # all still running
   ```

   Then smoke-test every ingress entry point against a published
   deployment's hostname (`*.service.kitegg.hs-mainz.de`), from outside
   the cluster:

   ```sh
   # via Traefik
   curl -I https://<name>.service.kitegg.hs-mainz.de
   # via the NGINX TLS proxy (NodePort)
   curl -I --resolve <name>.service.kitegg.hs-mainz.de:30443:<node-ip> \
     https://<name>.service.kitegg.hs-mainz.de:30443
   ```

   Both must answer (an auth redirect counts) on the declared service
   ports.

Maintenance: when a new system-internal service is added to the `services`
namespace, add its `app` label value to `SYSTEM_APP_LABEL_VALUES`
(`src/lib/constants.js`), redeploy the extension, and re-run the backfill
— otherwise user workloads may reach it.

**Cluster hardening manifests** (admin-owned, in [`k8s/`](k8s/), applied
independently of the extension):

1. [`k8s/pod-security.yaml`](k8s/pod-security.yaml) — Pod Security
   Admission on the namespace. Stage it: apply with
   `warn`/`audit: baseline`, check the stored-template scan from the
   manifest header stays empty, then uncomment `enforce: baseline`.
   (Audit-mode annotations land in the API server audit log, which this
   cluster does not run — the header documents the practical check.)
2. [`k8s/resource-quota.yaml`](k8s/resource-quota.yaml) — ResourceQuota
   - LimitRange bounding the namespace's total compute (sized at ~+50%
     over the measured ceiling) and object counts. The LimitRange is
     required next to the quota: it defaults CPU/memory requests for
     pods that declare none (the extension sets limits, requests only for
     GPUs). Applies to new pods only.
3. [`k8s/system-services-policy.yaml`](k8s/system-services-policy.yaml)
   — ingress protection for the system-internal services (`cache`,
   `service-proxy`, `nginx`, `openwebui*`, `tty-server`), closing the
   cluster-wide path to them (user pods were already denied via the
   policies above; other namespaces — e.g. jupyterhub — were not). The
   header documents the verified traffic matrix (oauth2-proxy sessions
   live in `cache`, Traefik/nginx are the ingress path, tty-server
   reaches user pods via the API). Egress of the system services is
   untouched; apply last and smoke-test the entry points immediately.
4. [`k8s/litellm-llp-allow.yaml`](k8s/litellm-llp-allow.yaml) — one-off
   ingress exception: opens the LiteLLM service of the deployment
   `sd-a53262dd-2d9c-44c0-83e2-e00d01cb2420` (port 4000) to the `llp`
   namespace. Purely additive to the policies above (which would
   otherwise deny `llp`); scoped to this single deployment and port.
   The header documents the URL breakdown, the llp-side egress caveat
   and the staleness risk if the deployment is re-created under a new
   id.
5. [`k8s/prometheus-allow.yaml`](k8s/prometheus-allow.yaml) — monitoring
   ingress: makes every pod in the `services` namespace (user deployments
   and the system-internal services alike) reachable from the
   `prometheus` namespace on all ports, so Prometheus can discover and
   scrape the whole namespace. Discovery itself (kubernetes_sd RBAC,
   CoreDNS) is egress/API business of the prometheus namespace; the
   header documents that split, the scope (including the system-services
   implication and the NotIn tightening option) and the rollout order
   against item 4 — apply this manifest first so the prometheus →
   LiteLLM flow moves over without a scrape gap.

MAINTENANCE: all five manifests encode live cluster facts (CIDRs,
traffic routes, sizing). Re-verify them when services, routes or
scales change — pointers are in each file's header.

To verify what the extension's account may do, run against the same cluster
and token:

```sh
kubectl auth can-i update secrets --namespace services \
  --server <cluster-url> --token "$K8S_USER_TOKEN"
kubectl auth can-i patch statefulsets/scale --namespace services \
  --server <cluster-url> --token "$K8S_USER_TOKEN"
```

A Kubernetes `403` surfaces in the error response `detail` as e.g.
`update secrets is forbidden: User "…" cannot update resource "secrets" in
API group "" in the namespace "services"` — this is distinct from the
extension's own ownership `403` (`api_errors.forbidden`).

### Container hardening

Deployed containers run under a hardened, non-negotiable-by-default
security context (see the YAML reference above for the user-facing
fields). Changes are part of the pod template, so they apply on each
deployment's **next redeploy** — running pods are never restarted by a
hardening rollout:

| Default                                                                        | Opt-out (per container, in the YAML)                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No service account token mounted (`automountServiceAccountToken: false`)       | none — user pods never reach the Kubernetes API (blocked by egress policies), the token would only be theft bait                                                                                                                                                                                                                          |
| Seccomp profile `RuntimeDefault`                                               | `seccomp: false` (e.g. for `strace`/`perf`)                                                                                                                                                                                                                                                                                               |
| Linux capabilities: `drop: ['ALL']`, `add: ['NET_BIND_SERVICE', ...requested]` | `capabilities: [...]` may request further capabilities from `ALLOWED_CAPABILITIES` (`src/lib/constants.js` — the Docker/containerd default set: `CHOWN`, `SETUID`, `NET_RAW`, …). `NET_BIND_SERVICE` is granted implicitly so images serving on port 80/443 keep working; `SYS_ADMIN`, `NET_ADMIN`, `SYS_PTRACE` etc. are never available |
| `runAsNonRoot: true`                                                           | `runAsRoot: true`                                                                                                                                                                                                                                                                                                                         |

Images must come from an allowed registry
(`DEFAULT_IMAGE_REGISTRIES` in `src/lib/constants.js`: docker.io,
ghcr.io, quay.io, nvcr.io, mcr.microsoft.com, registry.kitegg.de,
registry.motionbank.org). The env var `IMAGE_REGISTRY_ALLOWLIST`
(comma-separated) replaces the default list; `*` disables the check.
Bare image names resolve per the Docker reference rules
(`pytorch/pytorch`, `nginx:latest` and `ubuntu@sha256:…` all mean
docker.io). Deployments referencing other registries are rejected at
deploy time with the allowed list in the error message.

**Admin playbook:**

- Audit what is deployed versus the defaults (expect these lists to
  start full and shrink as users redeploy):

  ```sh
  # deployments running as root (runAsRoot opt-out)
  kubectl get sts -n services -o json | jq -r '
    .items[] | select(.spec.template.spec.securityContext.runAsNonRoot != true)
    | .metadata.name'
  # containers with capabilities beyond the default grant
  kubectl get sts -n services -o json | jq -r '
    .items[] | .metadata.name as $sts |
    .spec.template.spec.containers[]?
    | select(((.securityContext.capabilities.add // []) - ["NET_BIND_SERVICE"]) | length > 0)
    | "\($sts)/\(.name)"'
  # containers without the seccomp profile / with the token mounted
  kubectl get sts -n services -o json | jq -r '
    .items[] | .metadata.name as $sts |
    .spec.template.spec.containers[]?
    | select(.securityContext.seccompProfile.type != "RuntimeDefault")
    | "\($sts)/\(.name)"'
  kubectl get sts -n services -o json | jq -r '
    .items[] | select(.spec.template.spec.automountServiceAccountToken != false)
    | .metadata.name'
  ```

- To allow a capability that is not in the default set, add it to
  `ALLOWED_CAPABILITIES`, rebuild and redeploy the extension — it takes
  effect on the requesting deployment's next redeploy. Prefer builder
  alternatives where they exist (volume ownership via `fsUser`/
  `fsGroup` instead of `CHOWN`).

- Known-impossible requests, so you can answer them quickly: mounting
  external storage via FUSE (`rclone`, `sshfs`) needs `SYS_ADMIN` _and_
  a `/dev/fuse` device passthrough, which the deployment model does not
  offer — use PVCs/volumes instead; debuggers/profilers attaching to
  other processes (`SYS_PTRACE`) are not allowed — use logs and the pod
  events endpoints.

The required payload for the service is:

```json
{
  "title": "My NGINX Service",
  "data": "... valid YAML document (see below) ...",
  "exposed_service": "nginx",
  "exposed_port": 80,
  "exposed_hostname": "my-nginx-service"
}
```

The values for `exposed_service`, `exposed_port` and `exposed_hostname` (must be a unique, alphanumeric string allowing
only a dash as a special character) are optional and refer to the values in the YAML below.

The deployment's Directus `status` only controls its visibility in the
services overview — it has no effect on network access (see
[Network isolation](#network-isolation)).

The YAML describing the deployment is structured as follows:

```yaml
replicas: 1 # Allows scaling the service to multiple replicas (max. 16, with load-balancing)
restartPolicy: Never
containers:
  # Mandatory values
  - name: nginx
    image: "nginx:latest"
    ports:
      - name: default
        port: 80
    # Optional fields
    cpu: 8 # Allocate CPU cores (default is 4, maximum is 32; management: 256) — or a Kubernetes CPU quantity, e.g. '1500m'
    memory: 2 # Allocate memory in GiB (default is 32.0, maximum is 128.0; management: 512.0) — or a Kubernetes memory quantity, e.g. '2Gi'
    gpu: 'nvidia.com/gpu'  # Request a GPU resource (see below for valid options)
    command: '/bin/echo', # Override the container's command
    args: ['asdf', 'hello'], # Supply arguments to the container's command
    environment:
      - name: MY_ENV_VAR
        value: "asdf"
    # Set container runtime user and group, overriding defaults
    user: 1000
    group: 1000
    # Change filesystem ownership, overriding defaults
    fsUser: 1000
    fsGroup: 1000
    changeGroupOnMismatch: true # Optional

    # Container hardening (all on by default)
    runAsRoot: false # true: allow the image to run as root (opt-out of runAsNonRoot)
    seccomp: true # false: disable the default seccomp profile (e.g. for strace/perf)
    capabilities: ['CHOWN'] # extra capabilities beyond the drop of ALL;
    # NET_BIND_SERVICE is always granted so images serving on port 80/443 keep working
    # Images must come from an allowed registry (docker.io, ghcr.io, quay.io,
    # nvcr.io, mcr.microsoft.com, registry.kitegg.de, registry.motionbank.org;
    # IMAGE_REGISTRY_ALLOWLIST env overrides, '*' disables the check)

    # Volume mounts are optional as you can also deploy without persistence
    volumeMounts:
      - name: mydata
        mountPath: /mydata
        # Optional volume params
        readOnly: true
        type: 'ReadWriteOnce' # If used across replicas or services, use 'ReadWriteMany'

# The volumes section is only mandatory if mounts are specified (name has to match)
volumes:
  - name: mydata
    size: 1Gi  # This can be anything between 1-999 Gi or Mi (a plain number is Gi)
```

Capacity values (`cpu`, `memory` and volume `size`/`emptyDir.sizeLimit`) can be supplied either as plain numbers —
interpreted as cores (CPU), GiB (`memory` and volume `size`) or MiB (`emptyDir.sizeLimit`) — or as Kubernetes
quantity strings with an explicit unit (e.g. `cpu: '1500m'`, `memory: '512Mi'`, `size: '128Mi'`). The same
validation limits apply regardless of the form used.

These are the possible values for `gpu`:

```
nvidia.com/gpu
nvidia.com/mig-1g.10gb
nvidia.com/mig-2g.20gb
nvidia.com/mig-3g.40gb
```

After this has been successfully saved, the service can now be deployed with:

```
PUT /kubernetes/deployments/<service ID>
```

This should either return the deployment spec as JSON, or an error code with failed validation or other errors. To update
the deployment config, just send another PUT request after updating the collection.

Re-deploying updates the StatefulSet and rolls its pods. Note that the StatefulSet controller's rolling update never
touches a pod that never became Ready (`CreateContainerConfigError`, `CrashLoopBackOff`, `Pending`) — it would keep
running the old template forever. Re-deploying therefore also deletes that deployment's not-ready pods so the controller
recreates them from the new template immediately; pods that are Ready keep the controller's normal rolling update.

### Querying a deployment status

After a successful deployment, the service takes a moment to pull images, create volumes, etc. You can get the service
status by querying:

```
GET /kubernetes/deployments/<service ID>
```

This request returns an object in this format:

```json
{
  "replicas": 1,
  "currentReplicas": 1,
  "pods": [
    {
      "name": "asdf-1234",
      "phase": "Pending",
      "containers": [
        {
          "name": "nginx",
          "ready": true,
          "started": true
        }
      ]
    }
  ],
  "volumes": [
    {
      "name": "mydata",
      "phase": "Bound",
      "capacity": "1Gi",
      "type": "ReadWriteOnce"
    }
  ]
}
```

### Configs

Configs allow you to store variables to reference in your YAML deployment setup.

Using this endpoint:

```
PUT /kubernetes/deployments/<service ID>/config
```

and a payload like this:

```yaml
myVariable: asdf
otherVariable: ghjk
```

```json
{
  "data": "<YAML content>"
}
```

or just using a plain object:

```json
{
  "data": {
    "key": "value"
  }
}
```

Retrieving an existing config uses a `GET` method call to the same endpoint.

Configs can then be used as environment variables:

```yaml
containers:
  - name: example
    environment:
      - name: MY_ENV_VAR
        fromConfig: myConfigKey
```

### Secrets

Secrets allow you to store secret variables like API keys separately.

Using this endpoint:

```
PUT /kubernetes/deployments/<service ID>/secret
```

and a YAML payload like this:

```yaml
mySecretKey: asdf
otherValue: ghjk
```

```json
{
  "data": "<YAML content>"
}
```

or just using a plain object:

```json
{
  "data": {
    "key": "value"
  }
}
```

Retrieving an existing secret uses a `GET` method call to the same endpoint.

Secrets can then be used as environment variables:

```yaml
containers:
  - name: example
    environment:
      - name: MY_SECRET_ENV_VAR
        fromSecret: mySecretKey
```

### Deployment Hooks

#### Restart

To restart the deployment, you can access this hook:

```
POST /kubernetes/deployments/<service ID>/hooks/restart
```

### Scaling (stopping) a deployment

To change the scale of a deployment at runtime, call this endpoint:

```
PATCH /kubernetes/deployments/<service ID>?scale=<0-16>
```

The scale must be an integer between 0 and 16; other values are rejected with a
400 response.

Note: Using `0` is equivalent to stopping the deployment without removing resources.

### Deleting a deployment

To delete a deployment and all associated resources:

```
DELETE /kubernetes/deployments/<service ID>
```

**Deleting the Directus item also undeploys:** a bundled hook
(`src/hooks/undeploy-on-delete.js`) listens for `deployments.items.delete`
and runs the same cleanup as this endpoint the moment the item is removed —
item deletion alone is therefore enough to fully remove a service. If the
cleanup fails, the item deletion is aborted so nothing is left behind
silently; both the cleanup and the deletion are idempotent and can simply
be retried. The endpoint above remains for undeploying a service without
deleting its item.

### Getting logs for a deployment's pod

To return a Pod's log:

```
GET /kubernetes/deployments/<service ID>/logs/<pod name>
```

The pod name can be taken from the `pods.name` property of the deployment status. Only pods belonging to this deployment
can be accessed; pod names from other deployments return a 404 response.

Optionally, additional settings can be appended as query parameters:

```
container=<container name>    # If multiple containers are running in the pod
sinceSeconds=123              # Only fetch logs reaching back N seconds
previous=true                 # Get the logs for the previous crashed or killed pod
timestamps=true               # Adds timestamps to the log lines
```

### Getting events for a deployment's pod

To request events regarding the status of the deployment, poll this endpoint path:

```
GET /kubernetes/deployments/<deployment ID>/events/<pod name>
```

Only pods belonging to this deployment can be queried; pod names from other deployments return a 404 response.

An example output:

```json
[
  {
    "creationTimestamp": "2024-04-17T09:05:33.000Z",
    "note": "0/8 nodes are available: 3 node(s) didn't match Pod's node affinity/selector, 5 Insufficient nvidia/gpu. preemption: 0/8 nodes are available: 3 Preemption is not helpful for scheduling, 5 No preemption victims found for incoming pod.",
    "reason": "FailedScheduling",
    "type": "Warning"
  }
]
```

### Delete a deployment's pod

To delete a pod and its containers within a deployment, call:

```
DELETE /kubernetes/deployments/<deployment ID>/pods/<pod name>
```

Note that the pod will be deleted, but a new one will immediately be created. This can be used to restart a deployment's
pod. Only pods belonging to this deployment can be deleted; pod names from other deployments return a 404 response.

## License

Licensed under the EUPL, Version 1.2 or — as soon they will be approved by the European Commission — subsequent versions of the EUPL (the "Licence").

You may not use this work except in compliance with the Licence.

You may obtain a copy of the Licence at:

https://joinup.ec.europa.eu/collection/eupl/eupl-text-eupl-12

A copy is also included in the [`LICENSE`](LICENSE) file.

Unless required by applicable law or agreed to in writing, software distributed under the Licence is distributed on an "AS IS" basis, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.

See the Licence for the specific language governing permissions and limitations under the Licence.
