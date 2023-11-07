# GitOps Repo

The idea here is that we use google APIs to create the project and initial
cluster, then use config connector to manage any other cloud provider resources
in the project, and other controllers to manage the infra behind all of our
first and third-party custom resources.

The process so far is to run `npm start` in the `bootstrap` dir. This is
currently highly GCP specific, though it'd be interesting to support multiple
providers.

## Secrets

There is not yet a strategy for dealing with secrets. There are a number of options.

I have a few secrets currently in .gitignore files that I'm currently manually
to the cluster. This is not a strategy, but it's a thing to be aware of.

## Authentication

The scripts expect you to be authenticated with `gcloud` in order to create the
project and cluster and then authenticate with and mutate it through the kube
API. You must also have a billing account setup to be bound to the project.

The bootstrap scripts drop a `kubeconfig.yaml` file that includes the k8s
server TLS cert, and effectively defers auth to gcloud through the
gke-gcloud-auth-plugin component(also installed by the flake), so it contains
nothing sensitive.

Once the bootstrap has written the kubeconfig file, you can do `export
KUBECONFIG=$(pwd)/bootstrap/kubeconfig.yaml`, and easily use tooling like
kubectl and k9s.

If you use such tooling to port forward to the argo-server UI, you can find the
initial admin password in a dynamically generated secret resource. One such
method using kubectl: `kubectl -n argocd get secret argocd-initial-admin-secret
-o jsonpath="{.data.password}" | base64 -d`.

This pulls the secret value out of your cluster and decodes it to human
readable text, which is then shown to you on the CLI (and can be used in the
port-fowarded UI). Access to this fully-functional k8s resource mgmt controller
with UI is pretty early-stage.

## Project

The project is defined in `project.yaml` there's not much to it. This is
referenced from other sections of the code so they know where to act.

Once the project is created, the base APIs and the GKE API are enabled on the
project. Any other enablements would be the realm of KCC.

## Cluster

The GKE bootstrap cluster is defined in `cluster.yaml`. The schema is exactly
that of the google API's [schema for clusters](https://cloud.google.com/kubernetes-engine/docs/reference/rest/v1beta1/projects.locations.clusters#Cluster).

When the cluster yaml is read by the bootstrap scripts, it is evaluated as a
template string so that properties of variables like `project` can be pulled
in using javascript template string syntax.

The cluster runs spot instances, and has workload ID and Config Connector enabled.

It's expected that this repo evolves to support a number of projects and
clusters. Besides the primary cluster, though, additional clusters would be
created with kcc resources after bootstrap.

## GitOps Bind

Once the cluster is up and running, we can deploy our gitops operator and have
the git repo take control of ops from here on. We'll want to create a KCC
Project resource for the bootstrap project to take control of it.

Firstly, the automation installs argocd with what's effectively `kustomize
build apps/argocd/overlays/primary | kubectl apply -f-`. Once argo is stable,
it then applies `kubectl apply -f clusters/primary/appoapp.yaml` to install the
app-of-apps that will eventually converge on having all of our applications
configured and installed.

The argo Application in the `appoapp.yaml` points at `clusters/primary` which
is a kustomization that loads any cluster-level resources, and the `apps`
kustomization. The apps kustomization renders all the other argo Applications
that should be made available in the cluster.

The `clusters/primary/apps/kustomization.yaml` might look like this:
```yaml
namespace: argocd
resources:
# Applications to run on the cluster
- argocd.yaml
- jspolicy.yaml
- gptpolicy.yaml
- httpbin.yaml

patches:
# base application settings patch
- path: base.patch.yaml
  target:
    group: argoproj.io
    kind: Application
```

We have tried the Application-to-control-the-appoapp pattern, but it tends to
fight against you when you need to fix things, and mistakes in automation can
try to delete your cluster. So this is intentionally a weak root, in the sense
that it's not tied to any machinery that might try to delete it.

It's intended to live the life of the cluster, and any updates too it
necessitate a human touch in any case.

Do we want to just shell out to `kubectl`, or use our own client library to
talk to the cluster? A: Ended up shelling out(all toolilng is available from
the flake devshell), dealing with all the dynamic type handling in the kube API
was out of the scope of what I wanted to do directly with node libs.

After bootstrap, all other mutations of the kube API are handled by argo, so
making this complicated is low-value.

## Local Config Mgmt Cluster
Decided: NO

Do we actually want to run config mgmt in a containerized k0s(or something)
cluster with config connector controller installed? Akin to a terraform
statefile but in KRM.

Not sure how ephemeral this could be... or how it would react to being
regularly unavailable. Like terraform, you really want the statefile easily
accessble to humans and tooling.

Running a dedicated GKE cluster for config mgmt is overkill for most, but
perhaps the intent should be the primary cluster is the starter home,
additional projects/clusters is an advanced use-case.

The bootstrap cluster would need to be built in a way that it can run all the
workloads for most deployments, while being able to run as the config mgmt hub
for the more complex. Policies (network et al.) will be particulaly important
in properly isolating the controlplane-controlplane in such hybrid clusters..
