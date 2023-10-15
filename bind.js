import { writeFileSync } from 'fs'
import { promisify } from 'util'
import { exec } from 'child_process'
const pexec = promisify(exec)
import k8s from '@kubernetes/client-node'
import yaml from 'js-yaml'
import { Roarr } from 'roarr'
import serializeError from 'serialize-error';

import { appname, argourl } from './consts.js'

const log = Roarr.child({ appname, subsys: 'bind' })

class LooseApiClient {
  constructor(config) {
    this.config = config
  }

  async get(path) {
    const ctx = this.config.baseServer.makeRequestContext(path, 'GET')
    ctx.setHeaderParam("Accept", "application/json, */*;q=0.8")

    const authMethod = this.config.authMethods.default
    await authMethod.applySecurityAuthentication(ctx)

    const res = await this.config.httpApi.send(ctx).toPromise()
    const body = JSON.parse(await res.body.text())

    return body
  }
}

async function run(cmd) {
  let {stdout, stderr} = await pexec(cmd)
  log({stdout, stderr}, 'from kustomize pipe')
}

export default async function reconcile(project, cluster) {
  const kubeconfig = createKubeconfig(cluster)
  log({kubeconfig}, 'Built kubeconfig')

  // Write kubeconfig to file
  writeFileSync('kubeconfig.yaml', yaml.dump(kubeconfig))
  process.env.KUBECONFIG = './kubeconfig.yaml'

  try {
    await run(`kustomize build apps/argocd/overlays/primary | kubectl apply -f-`)
    await run(`kubectl apply -f clusters/primary/appoapp.yaml`)
  } catch(error) {
    log({error: serializeError(error)}, 'Error reconciling bootstrap')
  }

  // Load the kubeconfig yaml into the k8s lib
//  const kc = new k8s.KubeConfig()
//  kc.loadFromOptions(kubeconfig)
//
//  // Auth with default creds, not usually what you want in this stack
//  // but can be useful for some situations
//  //kc.loadFromDefault() 
//
//  const lapi = kc.makeApiClient(LooseApiClient)
//
//  //const iresp = await fetch(argourl)
//  //const argoinst = await iresp.text()
//
//
//  // Our api clients
//  const k8sApi = kc.makeApiClient(k8s.CoreV1Api)
//
//  // Bootsrap the cluster with argo
//  //const res = await k8sApi.listNamespacedPod('kube-system')
//  const res = await lapi.get(`/apis/scheduling.k8s.io/v1/`)
//  log({res}, 'result')
//  for (const item of res.items) {
//    log({item}, 'item')
//  }
}

function createKubeconfig(cluster) {
  // kubeconfig from cluster reconcile stage
  //eslint-disable-next-line no-unused-vars
  return {
    apiVersion: 'v1',
    kind: 'Config',
    preferences: {},
    ['current-context']: cluster.name,
    clusters: [
      {
        name: cluster.name,
        cluster: {
          ['certificate-authority-data']: cluster.masterAuth.clusterCaCertificate,
          server: `https://${cluster.endpoint}`,
        },
      },
    ],
    contexts: [
      {
        name: cluster.name,
        context: {
          cluster: cluster.name,
          user: cluster.name,
        },
      },
    ],
    users: [
      {
        name: cluster.name,
        user: {
          exec: {
            apiVersion: 'client.authentication.k8s.io/v1beta1',
            command: 'gke-gcloud-auth-plugin',
            provideClusterInfo: true,
          },
        },
      },
    ],
  }
}
