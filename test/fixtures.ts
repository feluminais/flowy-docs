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

/**
 * The shop with one failure analysis. Ratings (severity/occurrence/detection) and what they make:
 * db-down 10/2/2 (risk 40, High because severity is 10), mail-timeout 3/6/7 (126, Medium) on the orders → mail line,
 * api-slow 4/5/3 (60, Medium), auth-lock 6/5/5 (150, High), web-glitch 2/3/2 (12, Low), orders-unrated 5 only (Not rated).
 * Has no problems.
 */
export function shopWithFailures(): Model {
  return {
    ...shop(),
    failures: {
      ordering: {
        name: 'Ordering',
        scope: 'shop',
        modes: {
          'db-down': { mode: 'The database is unreachable', on: 'db', effect: "Orders can't be saved.", severity: '10', occurrence: '2', detection: '2' },
          'mail-timeout': { mode: "The mail service doesn't answer", from: 'orders', to: 'mail', effect: 'Receipts arrive late.', severity: '3', occurrence: '6', detection: '7' },
          'api-slow': { mode: 'The API answers slowly', on: 'api', effect: 'Pages hang.', severity: '4', occurrence: '5', detection: '3' },
          'auth-lock': { mode: 'The login lock is never released', on: 'auth', effect: 'Nobody can sign in.', severity: '6', occurrence: '5', detection: '5' },
          'web-glitch': { mode: 'The page flickers', on: 'web', effect: 'A customer is annoyed.', severity: '2', occurrence: '3', detection: '2' },
          'orders-unrated': { mode: 'An order is counted twice', on: 'orders', effect: 'A customer is billed twice.', severity: '5' },
        },
      },
    },
  }
}
