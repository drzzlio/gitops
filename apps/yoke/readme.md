# Yoke

The thing that controls planes.

We're talking about an ephemeral k8s controlplane controller. Since a goal is
to run on spot instances, with single-instance controlplanes, we need something
that's robust to disappearing while storing no critical data in storage that
scales poorly, like cloud instance block storage.

We want lots of them! We want them to all to be instantly available, and robust
to disasters. We want to make kubernetes, kubernetEZ.

# Cluster Controller

We've forked k0smotron and ripped out all the cluster-API stuff as we don't
need it (the hybrid-cloud aspect is interesting, and while I think cloud VMs
will be a popular use, automating that is not our core mission).

What's left over is straight-forward enough that it's to a point I think we're
going to do customization deeper than a general upstream controller can
provide.

Each cluster and its accoutrement are isolated in a unique namespace.

Notes:

TODO: Make the controlplane ephemeral, we need to deliver all state to the
controlplane from outside the pod.

- [ ] PKI

# Network Policy

Need to thoughtfully handle connectivity constraints for a number of different
use-cases, especially as we begin to develop networking and other features, but
at the start we should be able to mostly isolate the controlplane outside of
egress for nats and ingress for k8s api and konnectivity.

# Joining

Joining workers to the cluster needs to [be](be) rapid and transparent.

Notes:

SSH UI?

# Cluster Component Updates

The k0s project recently released a plan-based autoupdate system called
autopilot, we may want to look at using it for worker updates.

For the controlplane, the update will cause downtime as we simply change the
`version` setting in the cluster CRD, which controls the image used in the
controlplane's statefulset.

# Worker OS Updates

Ultimately the project will release a purpose-built worker containerOS that
runs on any CPUs we support which would give a homogenous target for handling
update automation. Until then, we may be able to make a fairly OS-agnostic update
module using standard CMS tooling running as a job or part of a daemon on the
node.

# Networking

# Firewall

We want to be able to handle firewalling to protect both the nodes themselves,
but also for cluster workloads and even other hosts on a network segment(in the
case of a network gateway worker).

# Tunnels

Ingress and host-aware Wireguard peering.

# Cloud Provider Detection and Control

Workers should be able to detect and report information about the environment
they're running in. In case a worker is running on a provider's platform, it
can be used by our platform to delegate change control for the local PaaS to
the controlplane.

# Local Peer Detection

# IP Allocation (IPV6?)

# DNS

We want to expose workloads in a number of ways. Besides other workloads in the
cluster, we sometimes want to expose endpoints in a particular local network.
Having control over naming in a network gives you a lot of power to build
topologies look flat.

Outside of k8s service discovery, where DNS is used exclusively by default,
using DNS for routing requests into the cluster from other domains will be key
for hybrid routed/tunneled connectivity networks. For network wonks, I suppose
you might call this westbound ingress.

There is, however a special network zone, the internet network zone. We
absolutely want to drive automation around allocating "real" internet-facing
resources like domain names and certificates.

Normalizing the use of cloud providers as internet integration points makes it
much easier to do things like use provider APIs to groom primary DNS for your
domain which also opens up the pathway to ACME DNS01 to let's encrypt for free
public certs.

Having even a free-tier VM on most of the large providers is enough to
get a persistent foot online, like an Artemis Gateway in the internet's orbit.

This obviates the need for punching holes into other networks; in
networks under a certain size, they can all be completely internet-isolated and
still host internet-exposed services through a designated ingress gateway. An
example would be exposing the fluidd 3D printer web interface running on an rpi
to pull it up on your phone from anywhere.

# Utilization

We need these controlplanes to be as light-weight as possible so we can pack
them tight. We may need to do some profiling here, as there seems to be cases
where even a controlplane with no workers was using nearly a whole core at
idle, while logging showed no indication of work being done.

# Accounting

If we do want to provide services ancillary to the controlplane(networking,
gitops, backups, storage), we need to be able to properly account for their
utilization. If we want this to be a sustainable project, it needs to create
more value than it consumes.

This needs to be open, apparent, and be the direct source from which prices are
calculated. As we drive the project beyond unity, having this metric out front
will be a critical success signal.

# Ingress

Envoy is our proxy poison of choice, we have a controller that watches for
cluster services to come online in the host cluster, and updates the ingress
proxy configmap. Envoy watches the directory where the configmaps are stored
and reloads immediately and online with any updates.

Notes:

TODO: Implement ingress controller, generate envoy configmaps with cluster
ingress routing config, using base configmaps to allow manual config of
more static ingress routes.

Do we want to fill the config with k8s endpoints or with the services
themselves? The former comes with a much higher churn rate, but some benefits
in load balancing. However, considering our single-instance upstreams, that
matters little.

Do we need distributed statistics?

Most controlplanes I've seen, require an IP-per-controlplane in order to
properly get traffic delivered. We can't afford the IPv4 addresses that would
be necessary to do that, so we need to make multiplexed ingress work.

Everything connects via HTTP(k8s API, konnectivity), so it should theoretically
be possible.

SNI from in-cluster services will, in most cases, have an SNI of
`kubernetes.default.svc`, while connections from user tooling and the workers
themselves send a proper SNI configured via the k0smotron externalAddress
config, and gets embedded in the join token and generated kubeconfigs.

For the in-cluster service use-case, we may be able to solve by adding a custom
entry to the service account JWT token aud claim. The k8s api-server has a flag
that allows setting what should be in this field; as an example, k0s includes
konnectivity in the audience as well as `https://kubernetes.default.svc`.

The ingress could then validate and extract this cluster-unique aud claim and
route based on that.

# Storage

There are two primary places we're targetting cluster state storage. The first
is a nats jetstream cluster used as a shared backing store for the kine
instance backing each controlplane, the second is the k8s API of the host cluster.

# Certificates

Certs are a state that we need to set up in a way that will allow us to
efficiently and securely multiplex controlplane connections from users,
external k8s tooling, workers, and k8s workloads(service accounts).

Certificates are a also a space where most tooling focuses on automating the
handling of PKI. This means with a lot of tooling, CA secrets are available on
controlplane nodes. Kubernetes itself, however, can be run in non-signing mode
so that these keys need not be distributed to the controlplane as long as all
the necessary certificates are provided.

To handle persistence and secure PKI processing, we use cert-manager to
generate the needed certs, storing this state in the host cluster k8s API.

We use a pretty standard intermediate hierarchy(standard on the web, not so
much with k8s), creating a primary root CA with intermediates for cluster CAs.
We are doing this for a couple reasons, first we want to be able to
transparently rotate the cluster CA intermediates with an expiration overlap,
being able to do this means we can issue shorter-lived certs and rotate more
often.

Secondly, we need to issue an intermediate for signing the public ingress
certs. As the server-side of a TLS connection sends its intermediate as part of
the connection, and the client only has the root CA for validation, we can have
the ingress MitM traffic to handle multiplexed routing for all target clusters
while controlplane-local processes still able to validate the connection.

Each cluster has their intermediate CA issued from the root CA. All other certs
for the cluster are signed by this intermediate. The cert for TLS on the API
server will have a SAN `<clustername>.<clusterns>.svc`, this is
the name that will be used to secure the ingress->controlplane connections.

We then also mint an intermediate for issuing public ingress proxy certs with
SANs for wildcard `*.clusters.drzzl.io`, and `kubernetes.default.svc(.cluster(.local))`.

Because kubernetes libs and tooling all require having the trust CA provided to
connect, public ingress doesn't need to worry about issuing certs from orgs
like let's encrypt as we simply provide our root CA cert to the tooling.

sa.pub/key: An RSA pub/private key (a cert/key can be used also) for the
cluster to use for signing service account JWTs.

server.crt/key: The PKI material used the api-server TLS listener.

front-proxy.crt/key: The PKI material used by the api-server to issue
internal-use cert/key for connecting to extension API servers.

Notes:

We'll need to modify k0smotron and maybe k0s in order to support delivering all
certs that require signing by the cluster intermediate CA instead of providing
the CA and key for k0s' PKI automation.

Issuing dynamic client certs for kubelet auth may cause some complications.
Giving the controlplane the ability to create Certificate CRDs in its namespace
could be a solution here.

TODO: Figure out the rotation workflow details
TODO: Root CA should be stored in a KMS(and maybe the intermediates).

# Kine and NATs

As kine has a nats jetstream bucket backend, and NATs is powerfully fault
tolerant, we're going to use a shared instance of NATs as the backend target
for the ephemeral controlplanes.

Each user's controlplanes will be part of a NATs Account, giving isolated
access to a virtual cluster. The connection will run with two replicas for
tolerance to NATs pod failures.

A replication hierarchy for sending bucket changes to other failure domains
gives us a place to source highly-granular point-in-time restorations of
cluster state. With strategic replication, and the message-based nature of
jetstream, we may potentially go without the need for more traditional backup
methodologies.

Notes:

Nack, the jetstream configuration controller, is installed but am unsure if
this will work well for configuration of the buckets. It _does_ support
Accounts, which may be enough to meet our needs for tenant isolation, just
let the controlplanes create their assigned buckets.

An interesting thought was proposed by [the blog post](https://nats.io/blog/exploring-nats-as-a-backend-for-k3s/) talking about kine's NATs
integration, where leaf nodes are run next to the controlplane and then peer
with superclusters. There could be some interesting benefits to doing this with
our ephemeral controlplanes, but unsure if they align with our goals or if
they're substantial enough for the compute costs.

Do we want to provide messaging infra as a service?

TODO: Get Accounts and auth working
TODO: Figure out a replication topology and start sending data offsite

TODO: Deal with kine->NATS perf issues, it uses more cpu than the API server.

# Ephemeral Workers

For use-cases like short-term GPU instances, or spinning up extra compute
into the cluster from a containerized kubelet on your laptop or desktop itself.

Perhaps you code on your laptop but want to seamlessly run heavy appdev
dependencies or ML inference on a headless desktop sitting in your closet. An
ephemeral worker could temporarily tap your workstation into the power running
on your distributed network, like `docker run --rm` powered by k8s.

This would kind of be an inversion of control, where the node handles its
lifetime rather than the controlplane. These could be paired with the internet
ingress system to share in-the-moment projects to the internet simply and rapidly.

We will need some type of reasonably-timed dead-man's switch lock for these
instances so that the nodes can be automatically reaped in cases they're left
behind.
