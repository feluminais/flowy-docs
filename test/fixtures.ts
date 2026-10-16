import { emptyModel } from '../src/core/model.ts'
import type { Model } from '../src/core/model.ts'

/** A small shop with an actor, two systems, apps, a store and two components. Has no problems. */
export function shop(): Model {
  return {
    ...emptyModel(),
    objects: {
      customer: { type: 'actor', name: 'Customer' },
      shop: { type: 'system', name: 'Shop', description: 'Sells things online.\n\nLonger notes.' },
      web: { type: 'app', in: 'shop', name: 'Web app', tech: 'React' },
      api: { type: 'app', in: 'shop', name: 'API', tech: 'Node' },
      db: { type: 'store', in: 'shop', name: 'Orders DB', tech: 'Postgres' },
      auth: { type: 'component', in: 'api', name: 'Auth' },
      orders: { type: 'component', in: 'api', name: 'Orders' },
      mail: { type: 'system', name: 'Mail service' },
    },
    connections: [
      { from: 'customer', to: 'web', label: 'browses' },
      { from: 'web', to: 'api', label: 'REST' },
      { from: 'orders', to: 'db', label: 'reads/writes' },
      { from: 'auth', to: 'db', label: 'checks users' },
      { from: 'orders', to: 'mail', label: 'sends receipts' },
    ],
    flows: {
      checkout: {
        name: 'Customer checks out',
        view: 'shop',
        steps: [
          { from: 'customer', to: 'web', text: 'Clicks "Buy"' },
          { from: 'web', to: 'api', text: 'POST /orders' },
          { from: 'api', to: 'db', text: 'Saves the order' },
        ],
      },
    },
  }
}
