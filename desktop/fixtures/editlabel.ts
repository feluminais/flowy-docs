import { modelFiles, serializeLayout } from '../../src/core/modelfiles.ts'
import type { Layout, Model } from '../../src/core/model.ts'
import { shop } from '../../test/fixtures.ts'

// How an edit is named in the history ("Renamed Web app to Storefront"). The cases are the one table the TypeScript test and the C# tests both read:
// each is two models and the label the second earns. The C# side loads them from the files `dumpEditLabels` writes.

/** The small shop of test/fixtures.ts with some boxes placed in three views. */
function base(): Model {
  const layout: Layout = {
    root: { customer: [0, 0], shop: [100, 0], mail: [300, 0] },
    shop: { web: [10, 20], api: [200, 20], db: [100, 200] },
    api: { auth: [0, 0], orders: [120, 0] },
  }
  return { ...shop(), layout }
}

export type EditLabelCase = { name: string; before: Model; after: Model; label: string | undefined }

const make = (name: string, label: string | undefined, change: (m: Model) => void, prepare?: (m: Model) => void): EditLabelCase => {
  const before = base()
  prepare?.(before)
  const after = structuredClone(before)
  change(after)
  return { name, before, after, label }
}

const without = (m: Model, id: string) => {
  delete m.objects[id]
  m.connections = m.connections.filter(c => c.from !== id && c.to !== id)
  for (const positions of Object.values(m.layout)) delete positions[id]
}

export const CASES: EditLabelCase[] = [
  make('an added system', 'Added the Stripe system', m => { m.objects.stripe = { type: 'system', name: 'Stripe' } }),
  make('an added actor', 'Added the Admin actor', m => { m.objects.admin = { type: 'actor', name: 'Admin' } }),
  make('two added shapes', 'Added 2 shapes', m => {
    m.objects.stripe = { type: 'system', name: 'Stripe' }
    m.objects.admin = { type: 'actor', name: 'Admin' }
  }),
  make('a deleted shape, with its lines and its place on the view', 'Deleted Orders', m => without(m, 'orders')),
  make('two deleted shapes', 'Deleted 2 shapes', m => {
    without(m, 'orders')
    without(m, 'auth')
  }),
  make('a renamed shape', 'Renamed Web app to Storefront', m => { m.objects.web.name = 'Storefront' }),
  make('two renamed shapes', 'Renamed 2 shapes', m => {
    m.objects.web.name = 'Storefront'
    m.objects.api.name = 'Backend'
  }),
  make('a long name is cut', `Renamed Web app to ${'x'.repeat(40)}…`, m => { m.objects.web.name = 'x'.repeat(60) }),
  make('a shape moved to the top level', 'Moved Web app to the top level', m => { delete m.objects.web.in }),
  make('a shape moved into another', 'Moved Web app into Mail service', m => { m.objects.web.in = 'mail' }),
  make('two shapes moved into another', 'Moved 2 shapes', m => {
    m.objects.web.in = 'mail'
    m.objects.api.in = 'mail'
  }),
  make('one field', "Changed API's tech", m => { m.objects.api.tech = 'Express' }),
  make('two fields of one shape', 'Changed API', m => {
    m.objects.api.tech = 'Express'
    m.objects.api.description = 'Takes the orders.'
  }),
  make('one field on two shapes', 'Changed 2 shapes', m => {
    m.objects.api.tech = 'Express'
    m.objects.web.tech = 'Vue'
  }),
  make('the look of a shape', "Changed API's look", m => {
    m.objects.api.color = 'amber'
    m.objects.api.shape = 'hexagon'
  }),
  make('the outside flag', "Changed Mail service's external", m => { m.objects.mail.external = 'true' }),
  make('a key Flowy does not know', "Changed API's details", m => { m.objects.api.owner = 'payments' }),
  make('a line added', 'Connected Web app to Orders DB', m => { m.connections.push({ from: 'web', to: 'db' }) }),
  make('a line removed', 'Disconnected Web app from API', m => { m.connections = m.connections.filter(c => !(c.from === 'web' && c.to === 'api')) }),
  make('a line relabelled', 'Relabelled Web app to API', m => { m.connections.find(c => c.from === 'web' && c.to === 'api')!.label = 'HTTP' }),
  make('two lines added', 'Added 2 lines', m => {
    m.connections.push({ from: 'web', to: 'db' })
    m.connections.push({ from: 'api', to: 'mail' })
  }),
  make('two lines removed', 'Removed 2 lines', m => { m.connections = m.connections.filter(c => c.from !== 'orders') }),
  make('a flow added', 'Added the Refund flow', m => { m.flows.refund = { name: 'Refund', view: 'shop', steps: [{ from: 'web', to: 'api', text: 'Refunds' }] } }),
  make('a flow deleted', 'Deleted the Customer checks out flow', m => { delete m.flows.checkout }),
  make('a flow renamed', 'Renamed the flow Customer checks out to Pay', m => { m.flows.checkout.name = 'Pay' }),
  make('a flow changed', 'Changed the Customer checks out flow', m => { m.flows.checkout.steps[0].text = 'Presses Buy' }),
  make('a flow moved into a folder', 'Moved the Customer checks out flow into billing/refunds', m => { m.folders = { checkout: 'billing/refunds' } }),
  make('a flow moved to the top', 'Moved the Customer checks out flow to the top', m => { delete m.folders }, m => { m.folders = { checkout: 'billing' } }),
  make('a flow moved to another folder', 'Moved the Customer checks out flow into misc', m => { m.folders = { checkout: 'misc' } }, m => { m.folders = { checkout: 'billing' } }),
  make('a long folder name is cut', `Moved the Customer checks out flow into ${'x'.repeat(40)}…`, m => { m.folders = { checkout: 'x'.repeat(60) } }),
  make('a flow tagged', 'Changed the tags of the Customer checks out flow', m => { m.flows.checkout.tags = ['happy path'] }),
  make('a flow untagged', 'Changed the tags of the Customer checks out flow', m => { delete m.flows.checkout.tags }, m => { m.flows.checkout.tags = ['happy path'] }),
  make('a flow moved and changed', 'Changed the Customer checks out flow', m => {
    m.folders = { checkout: 'billing' }
    m.flows.checkout.steps[0].text = 'Presses Buy'
  }),
  make('a flow added in a folder', 'Added the Refund flow', m => {
    m.flows.refund = { name: 'Refund', view: 'shop', steps: [{ from: 'web', to: 'api', text: 'Refunds' }] }
    m.folders = { refund: 'billing' }
  }),
  make('a flow deleted from a folder', 'Deleted the Customer checks out flow', m => { delete m.flows.checkout; delete m.folders }, m => { m.folders = { checkout: 'billing' } }),
  make('a state set on a step', 'Set API to Stopped', m => { m.flows.checkout.steps[1].states = { api: 'stopped' } }),
  make('a state taken off a step', "Cleared API's state", m => { delete m.flows.checkout.steps[1].states }, m => { m.flows.checkout.steps[1].states = { api: 'stopped' } }),
  make('two flows', 'Changed 2 flows', m => {
    m.flows.refund = { name: 'Refund', view: 'shop', steps: [{ from: 'web', to: 'api', text: 'Refunds' }] }
    delete m.flows.checkout
  }),
  make('one shape moved', 'Moved Web app', m => { m.layout.shop.web = [15, 20] }),
  make('a shape placed for the first time', 'Moved Orders DB', m => { m.layout.shop.db = [100, 200] }, m => { delete m.layout.shop.db }),
  make('three shapes moved', 'Moved 3 shapes', m => {
    m.layout.shop.web = [15, 20]
    m.layout.shop.api = [210, 20]
    m.layout.shop.db = [100, 210]
  }),
  // The page saves every box of a view when one is first dragged in it, so the label cannot say which one was.
  make('the first positions of a view', 'Arranged Shop', m => { m.layout.shop = { web: [10, 20], api: [200, 20], db: [100, 200] } }, m => { delete m.layout.shop }),
  make('the first positions of the top level', 'Arranged the top level', m => { m.layout.root = { customer: [0, 0], shop: [100, 0], mail: [300, 0] } }, m => { delete m.layout.root }),
  make('the first positions of two views', 'Arranged 2 views', m => {
    m.layout.shop = { web: [10, 20] }
    m.layout.api = { auth: [0, 0] }
  }, m => {
    delete m.layout.shop
    delete m.layout.api
  }),
  make('a view tidied', 'Tidied Shop', m => { delete m.layout.shop }),
  make('the top level tidied', 'Tidied the top level', m => { delete m.layout.root }),
  make('the line style', 'Changed the line style', m => { m.meta.lines = 'curved' }),
  make('an icon added', 'Added the stripe icon', m => { m.meta.icons = { stripe: 'M4 4h16v16h-16z' } }),
  make('an icon deleted', 'Deleted the stripe icon', m => { delete m.meta.icons }, m => { m.meta.icons = { stripe: 'M4 4h16v16h-16z' } }),
  make('the project name', 'Renamed the project', m => { m.meta.name = 'Plum' }),
  make('the project description', 'Changed the project description', m => { m.meta.about = 'Food delivery.' }),
  make('the project name and description', 'Changed the project name and description', m => { m.meta.name = 'Plum'; m.meta.about = 'Food delivery.' }),
  make('another setting', 'Changed the settings', m => { m.meta.owner = 'platform' }),
  make('two kinds of change', 'Renamed Web app to Storefront and 1 other change', m => {
    m.objects.web.name = 'Storefront'
    m.connections.push({ from: 'web', to: 'db' })
  }),
  make('three kinds of change', 'Renamed Web app to Storefront and 2 other changes', m => {
    m.objects.web.name = 'Storefront'
    m.connections.push({ from: 'web', to: 'db' })
    m.layout.shop.api = [210, 20]
  }),
  make('a changed data', "Changed Orders DB's data", m => { m.objects.db.data = [{ name: 'orders', columns: ['id'] }] }),
  make('nothing changed', undefined, () => undefined),
]

/** The cases as files, so the C# side can read the models the same way it reads a folder. */
export function dumpEditLabels(): unknown {
  const files = (m: Model) => ({ ...modelFiles(m), 'layout.yaml': serializeLayout(m.layout) })
  return { cases: CASES.map(c => ({ name: c.name, before: files(c.before), after: files(c.after), label: c.label ?? null })) }
}
