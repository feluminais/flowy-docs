import { DatabaseSync } from 'node:sqlite'
import type { SQLInputValue } from 'node:sqlite'
import { performance } from 'node:perf_hooks'
import { Busy } from './stats.ts'
import type { Edge } from './stats.ts'

export const PAGES = 60
const PER_PAGE = 20

/**
 * The shop's one SQLite connection. Every call is synchronous and, with synchronous=FULL, every commit waits for
 * the disk, so a slow disk stalls the whole server: that is the limit this part brings. `busy` is how much of the
 * time the server spent inside it, and each call is also recorded on the edge of whoever made it.
 */
export class Db {
  readonly busy = new Busy()
  private db: DatabaseSync
  private statements = new Map<string, ReturnType<DatabaseSync['prepare']>>()

  constructor(file: string) {
    this.db = new DatabaseSync(file)
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE products (id INTEGER PRIMARY KEY, page INTEGER NOT NULL, name TEXT NOT NULL, price REAL NOT NULL);
      CREATE INDEX products_page ON products (page);
      CREATE TABLE orders (id INTEGER PRIMARY KEY, status TEXT NOT NULL, amount REAL NOT NULL, created INTEGER NOT NULL);
    `)
    const insert = this.db.prepare('INSERT INTO products (page, name, price) VALUES (?, ?, ?)')
    this.db.exec('BEGIN')
    for (let page = 1; page <= PAGES; page++) for (let i = 1; i <= PER_PAGE; i++) insert.run(page, `Product ${page}-${i}`, 1 + ((page * 7 + i * 13) % 90))
    this.db.exec('COMMIT')
  }

  private timed<T>(edge: Edge, sql: string, use: (statement: ReturnType<DatabaseSync['prepare']>) => T): T {
    let statement = this.statements.get(sql)
    if (!statement) {
      statement = this.db.prepare(sql)
      this.statements.set(sql, statement)
    }
    this.busy.enter()
    const t = performance.now()
    try {
      const result = use(statement)
      edge.record(performance.now() - t)
      return result
    } catch (e) {
      edge.record(performance.now() - t, false)
      throw e
    } finally {
      this.busy.leave()
    }
  }

  /** Run a statement that changes data; gives the id of a row it inserted. */
  run(edge: Edge, sql: string, ...params: SQLInputValue[]): number {
    return this.timed(edge, sql, s => Number(s.run(...params).lastInsertRowid))
  }
  get(edge: Edge, sql: string, ...params: SQLInputValue[]): Record<string, unknown> | undefined {
    return this.timed(edge, sql, s => s.get(...params) as Record<string, unknown> | undefined)
  }
  all(edge: Edge, sql: string, ...params: SQLInputValue[]): Record<string, unknown>[] {
    return this.timed(edge, sql, s => s.all(...params) as Record<string, unknown>[])
  }
  close(): void {
    this.db.close()
  }
}
