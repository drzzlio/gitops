import { setTimeout as delay } from 'node:timers/promises'
import { readFileSync } from 'fs'
import { ClusterManagerClient } from '@google-cloud/container'
import { Roarr } from 'roarr'
import yaml from 'js-yaml'

import { appname } from './consts.js'
const log = Roarr.child({ appname, subsys: 'cluster' })

const client = new ClusterManagerClient();

async function getCluster(project, def) {
    try {
      const [resp] = await client.getCluster({
        name: `projects/${project.projectId}/locations/${def.zone}/clusters/${def.cluster.name}`,
      });
      return resp;
    } catch (e) {
      if (e.code === 5) { // Not found
        return null;
      }
      throw e
    }
}

export default async function reconcile(project) {
  // eval as template string is poor-man's template engine
  const def = yaml.load(eval(`\`${readFileSync('cluster.yaml', 'utf8')}\``));

  log({name: def.cluster.name}, `Getting cluster ${def.cluster.name}`)
  let cluster
  cluster = await getCluster(project, def)
  if(cluster) {
    log({cluster}, 'Cluster exists, updates TBD')
    //TODO: Implement cluster updates? After bootstrap, cluster self-updates.
    // probably most useful for repairing botched bootstraps.
  } else {
    log('Creating cluster (this will take awhile)')
    await client.createCluster(def)

    // Loop checking the provisioning status
    cluster = await getCluster(project, def)
    while(cluster.status === 'PROVISIONING') {
      if(process.stdout.isTTY)
        process.stdout.write('.')
      await delay(10000)
      cluster = await getCluster(project, def)
    }
    if(process.stdout.isTTY)
      process.stdout.write('\n')

    log({name: cluster.name}, 'Provisioning complete')
  }

  return cluster
}
