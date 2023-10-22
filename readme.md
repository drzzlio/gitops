# GitOps Repo

The idea here is that we use google APIs to create the project and initial
cluster, then use config connector to manage any other cloud provider resources
in the project.

The process so far is to run `npm start` in the `bootstrap` dir. This is
currently highly GCP specific, though it'd be interesting to support multiple
providers.

## Secrets

There is not yet a strategy for dealing with secrets. There are a number of options.

## Authentication

The scripts expect you to be authenticated with `gcloud` in order to create the
project and cluster and then authenticate with it. You must also have a billing
account setup to be bound to the project.

## Project

The project is defined in `project.yaml` there's not much to it. This is
referenced from other sections of the code so they know where to act.

Once the project is created, the base APIs and the GKE API are enabled on the
project. Any other enablements would be the realm of KCC.

## Cluster

The bootstrap cluster is defined in `cluster.yaml`. The schema is exactly that
of the google API's [schema for clusters](https://cloud.google.com/kubernetes-engine/docs/reference/rest/v1beta1/projects.locations.clusters#Cluster).

When the cluster yaml is read by the script, it is evaluated as a template
string so that properties of variables like `project` can be pulled in.

The cluster runs spot instances, and has workload ID and Config Connector enabled.

It's expected that this repo evolves to support a number of projects and
clusters. Besides the primary cluster, though, additional clusters would be
created with kcc resources after bootstrap.

## GitOps Bind

Once the cluster is up and running, we can deploy our gitops operator and have
the git repo take control of ops from here on. We'll want to create a KCC
Project resource for the bootstrap project to take control of it.

This first applies the output of `kustomize build apps/argocd/overlays/primary`
to install argocd. It then applies `kustomize build clusters/primary/appoapp.yaml`
to install the app-of-apps that will eventually converge on having all of our
applications configured and installed.

Do we want to just shell out to `kubectl`, or use our own client library to
talk to the cluster?

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
for the more complex.

