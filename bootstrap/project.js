import { ProjectsClient } from '@google-cloud/resource-manager'
import { ServiceUsageClient } from '@google-cloud/service-usage'
import { CloudBillingClient } from '@google-cloud/billing'
import { iam as iamfactory, auth as gauth } from '@googleapis/iam'
import { Roarr } from 'roarr'
import { readFileSync } from 'fs'
import yaml from 'js-yaml'

import { appname } from './consts.js'
const log = Roarr.child({ appname, subsys: 'project' })

const client = new ProjectsClient()
const svcclient = new ServiceUsageClient()
const billclient = new CloudBillingClient()
// Only the REST-based googleapis library supports service account creation
const iam = iamfactory({
  version: 'v1',
  auth: new gauth.GoogleAuth({
    scopes: [ 'https://www.googleapis.com/auth/iam' ]
  }),
})

// Enables a named service given its path
async function enableService(name) {
  log({name}, 'Enabling service')
  const [op] = await svcclient.enableService({ name })
  await op.promise()
}

// Enable services needed for bootstrap
async function enableServices(id) {
  await enableService(`projects/${id}/services/cloudapis.googleapis.com`)
  await enableService(`projects/${id}/services/container.googleapis.com`)
}

// Find first billing account and attach to the project
async function attachBilling(name) {
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

// Ensure `kubecc` service account is created with the proper roles for config
// connector controller identity
async function reconcileKccServiceAccount(id) {
  const pname = `projects/${id}`
  const accountId = 'kubecc'
  const email = `${accountId}@${id}.iam.gserviceaccount.com`
  const name = `${pname}/serviceAccounts/${email}`

  log(`reconciling kubecc service account`)

  // Find an existing SA
  let found
  try {
    await iam.projects.serviceAccounts.get({ name })
    found = true
    log('kubecc service account exists')
  } catch(err) {
    // We're ok with not-found
    if(err.status != 404) {
      throw err
    }
  }

  // Create the SA on the project if it doesn't exist
  if(!found) {
    const resp = await iam.projects.serviceAccounts.create({
      name: pname,
      requestBody: {
        accountId,
        serviceAccount: {
          displayName: accountId,
          description: 'Kubernetes Config Connector Operator',
        },
      },
    })
    log(resp.data, 'created kubecc service account')
  }

  // We need to reconcile the policy binding list ourselves since there are no
  // API operations to interact with the bindings list directly.
  // We set roles similar to what you might give a terraform SA:
  // - Editor - make most changes in the project
  // - Cloud KMS Admin - for managing iam policy
  // - Service Account Admin - for managing iam policy
  // - <no doubt more will be added here>
  const roles = [
    'roles/editor',
    'roles/cloudkms.admin',
    'roles/iam.serviceAccountAdmin',
  ]

  // Ensures a member has a particular role on a policy.
  // returns truthy if a mutation occurred
  const roleconcile = (policy, member) => (role) => {
    let binding = policy.bindings.find(b => b.role === role)
    if(!binding || !binding.members.includes(member)) {
      if(!binding) {
        binding = { role, members: [] }
        policy.bindings = [ ...policy.bindings, binding]
      }
      binding.members = [ ...binding.members, member ]
      log(`missing kubecc role: ${role}`)
      return true
    }
  }

  // Get the current project policy
  const [ policy ] = await client.getIamPolicy({
    resource: pname,
  })

  // Reconciles a list of roles
  const roleconciler = roleconcile(policy, `serviceAccount:${email}`)

  // Do the reconciliation and update the policy if necessary
  if(
    roles
      .map(roleconciler)
      .some(mutated => !!mutated)
  ) {
    await client.setIamPolicy({
      resource: pname,
      policy,
    })
    log('kubecc service account roles updated in project policy')
  }
}

async function createProject(project) {
  try {
    const [op] = await client.createProject({ project })
    const [resp] = await op.promise()
    log({project: resp}, `Created project ${resp.name}`)

    await enableServices(resp.projectId)
    await attachBilling(resp.name)
    await reconcileKccServiceAccount(resp.projectId)
    
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
  await reconcileKccServiceAccount(resp.projectId)

  log({project: resp}, `Updated project ${resp.name}`)
  return resp
}

export default async function reconcile() {
  // Load project config from base config
  const def = yaml.load(readFileSync('project.yaml', 'utf8'))

  log(`Reconciling project ${def.projectId}`)

  // Find exisiting project with this ID
  let project
  const [ projects ] = await client.searchProjects({ query: `id:${def.projectId}`})
  if(projects.length) {
    project = projects[0]
  }

  // Create if it doesn't exist, otherwise update
  if(!project) {
    log('Creating project...')
    project = await createProject(def)
  } else {
    log('Updating project...')
    project = await updateProject({
      // get the name from the found project
      name: project.name,
      ...def,
    })
  }
  return project
}
