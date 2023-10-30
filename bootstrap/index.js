import { Roarr } from 'roarr'
import serializeError from 'serialize-error';

import reconcileProject from './project.js'
import reconcileCluster from './cluster.js'
import reconcileBind from './bind.js'
import { appname } from './consts.js'

const log = Roarr.child({ appname })

async function reconcile () {
  try {
    log('Reconciling bootsrap')
    const project = await reconcileProject()
    const cluster = await reconcileCluster(project)
    await reconcileBind(cluster)
  } catch(error) {
    log({error: serializeError(error)}, 'Error reconciling bootstrap')
  }
}

await reconcile()
