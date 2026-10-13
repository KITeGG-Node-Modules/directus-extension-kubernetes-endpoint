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

| Resource                  | Verbs                                                | Used by                                                                  |
| ------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------ |
| `apps/statefulsets`       | `get`, `list`, `create`, `update`, `patch`, `delete` | deploy, re-deploy (`update`), restart hook (`patch`), state/info, delete |
| `apps/statefulsets/scale` | `update`, `patch`                                    | scaling (`PATCH /deployments/:id?scale=…`)                               |
| `services`                | `get`, `create`, `patch`                             | deploy (ports of an existing service are patched)                        |
| `configmaps`              | `get`, `create`, `update`, `delete`                  | config endpoints, delete                                                 |
| `secrets`                 | `get`, `create`, `update`, `delete`                  | secret endpoints, delete                                                 |
| `persistentvolumeclaims`  | `list`, `delete`                                     | deployment info, delete                                                  |
| `pods`                    | `list`, `delete`                                     | state/info/logs/events, delete pod                                       |
| `pods/log`                | `get`                                                | pod logs                                                                 |
| `events.k8s.io/events`    | `get`, `list`                                        | pod events                                                               |

> **Note:** verbs are evaluated per resource; permissions on `statefulsets`
> do **not** imply permissions on the `statefulsets/scale` subresource. A
> role that only grants read/create therefore still fails with `403` for
> scaling, restarting, re-deploying existing services, secret/config
> updates and deletion — while first-time deploys and all read endpoints
> keep working.

Additionally, `GET /kubernetes/capacity` reads cluster-scoped resources
(nodes and pods across all namespaces) and needs a `ClusterRole` (included
in `k8s/rbac.yaml`).

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
