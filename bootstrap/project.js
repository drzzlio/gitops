import { ProjectsClient } from '@google-cloud/resource-manager'
import { ServiceUsageClient } from '@google-cloud/service-usage'
import { CloudBillingClient } from '@google-cloud/billing'
import { Roarr } from 'roarr'
import { readFileSync } from 'fs'
import yaml from 'js-yaml'

import { appname } from './consts.js'
const log = Roarr.child({ appname, subsys: 'project' })

const client = new ProjectsClient()
const svcclient = new ServiceUsageClient()
const billclient = new CloudBillingClient()

async function enableService(name) {
  log({name}, 'Enabling service')
  const [op] = await svcclient.enableService({ name })
  await op.promise()
}

async function enableServices(id) {
  await enableService(`projects/${id}/services/cloudapis.googleapis.com`)
  await enableService(`projects/${id}/services/container.googleapis.com`)
}

async function attachBilling(name) {
  // Find first billing account and attach to the project
  const [[account]] = await billclient.listBillingAccounts({})
  log(`Attaching billing account ${account.name}`)
  await billclient.updateProjectBillingInfo({
    name,
    projectBillingInfo: {
      billingEnabled: true,
      billingAccountName: account.name,
    },
  })
}

async function createProject(project) {
  try {
    const [op] = await client.createProject({ project })
    const [resp] = await op.promise()
    log({project: resp}, `Created project ${resp.name}`)

    await enableServices(resp.projectId)
    await attachBilling(resp.name)
    
    return resp
  } catch(error) {
    if(error.code == 6) {
      log('Project already exists')
      return
    }
    throw error
  }
}

async function updateProject(project) {
  const [op] = await client.updateProject({ project })
  const [resp] = await op.promise()

  await enableServices(resp.projectId)

  log({project: resp}, `Updated project ${resp.name}`)
  return resp
}

export default async function reconcile() {
  // Load project config from base config
  const def = yaml.load(readFileSync('project.yaml', 'utf8'))

  log({project: def}, `Reconciling project ${def.projectId}`)
  // If the project has a name, it already exists
  // We can't search for a project by ID, so this is our best indicator.
  // our first state... outside config
  let project
  if(def.name) {
    log('Updating project...')
    project = await updateProject(def)
  } else {
    log('Creating project...')
    // eslint-disable-next-line no-unused-vars
    project = await createProject(def)
    
    // FIXME: Inject project name (e.g. `projects/<project-number>`) to the conf file (or state file)?
    // this must be manually added to the yaml currently, but must be fixed before chaining.
  }

  return project
}
