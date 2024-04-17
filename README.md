# KITeGG Kubernetes Endpoint

> K8S control interface for the LLP

## Services Endpoints

### Deploying a service

First, the service needs to be created in the collection `deployments` in the LLP API.

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
containers:
  # Mandatory values
  - name: nginx
    image: "nginx:latest"
    ports:
      - name: default
        port: 80
    # Optional fields
    gpu: 'nvidia/gpu'  # Request a GPU resource (see below for valid options)
    environment:
      - name: MY_ENV_VAR
        value: "asdf"
    # Volume mounts are optional as you can also deploy without persistence
    volumeMounts:
      - name: mydata
        mountPath: /mydata
        # This can optionally be set to read-only
        readOnly: true

# The volumes section is only mandatory if mounts are specified (name has to match)
volumes:
  - name: mydata
    size: 1Gi  # This can be anything between 1-999 Gi or Mi
```

These are the possible values for `gpu`:

```
nvidia/gpu
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
      "capacity": "1Gi"
    }
  ]
}
```

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

The pod name can be taken from the `pods.name` property of the deployment status.

Optionally, additional settings can be appended as query parameters:

```
container=<container name>    # If multiple containers are running in the pod
sinceSeconds=123              # Only fetch logs reaching back N seconds
previous=true                 # Get the logs for the previous crashed or killed pod
```

### Getting events for a deployment's pod

To request events regarding the status of the deployment, poll this endpoint path:

``` 
GET /kubernetes/deployments/<deployment ID>/events/<pod name>
```

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
