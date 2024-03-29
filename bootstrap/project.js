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
    scopes: ['https://www.googleapis.com/auth/iam']
  }),
})

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

async function reconcileKccServiceAccount(project) {
  const accountId = 'kubecc'
  const pname = `projects/${project}`
  const email = `${accountId}@${project}.iam.gserviceaccount.com`
  const name = `${pname}/serviceAccounts/${email}`

  log(`reconciling kubecc service account`)

  // Find an existing SA
  var exsa = null
  try {
    exsa = await iam.projects.serviceAccounts.get({ name })
    log('kubecc service account exists')
  } catch(err) {
    // We're ok with not-found
    if(err.status != 404) {
      throw err
    }
  }

  // Create the sa if it doesn't exist
  if(!exsa) {
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
  // Set roles:
  // Editor
  // Cloud KMS Admin
  // Service Account Admin

  // Ensures a member has a particular role on a policy.
  // returns truthy if a mutation occurred
  const roleconcile = (policy, member) => (role) => {
    const binding = policy.bindings.find(b => b.role === role)
    if(!binding || !binding.members.includes(member)) {
      if(!binding) {
        policy.bindings = [ ...policy.bindings, {
          role,
          members: [ member ],
        }]
      } else {
        binding.members = [ ...binding.members, member ]
      }
      return true
    }
  }

  // Get the current project policy
  const [ policy ] = await client.getIamPolicy({
    resource: pname,
  })

  // Reconciles a list of roles
  const roleconciler = (...roles) =>
    roles
      .map(roleconcile(policy, `serviceAccount:${email}`))
      .some(m => !!m)

  // Do the reconciliation and update the policy if necessary
  if(roleconciler(
    'roles/editor',
    'roles/iam.serviceAccountAdmin',
    'roles/cloudkms.admin',
  )) {
    await client.setIamPolicy({
      resource: pname,
      policy,
    })
    log('kubecc service account roles updated in project policy')
  }
}

export default async function reconcile() {
  // Load project config from base config
  const def = yaml.load(readFileSync('project.yaml', 'utf8'))

  log(`Reconciling project ${def.projectId}`)
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
