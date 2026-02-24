/**
 * MockSupabaseClient — in-memory Supabase query builder for tests.
 *
 * Supports the chainable API: client.from('table').select().eq().order().limit().single()
 * All data lives in a plain Record<string, any[]> — no real DB involved.
 */

type TableData = Record<string, any[]>
type LogEntry = { table: string; data: any; match?: Record<string, any> }

// ─── MockSupabaseClient ────────────────────────────────────────────────

export class MockSupabaseClient {
  tables: TableData
  private _insertLog: LogEntry[] = []
  private _updateLog: LogEntry[] = []
  private _upsertLog: LogEntry[] = []
  private _deleteLog: LogEntry[] = []
  private _rpcHandlers: Record<string, (params: any) => any> = {}
  private _nextId = 10000

  constructor(initialData?: TableData) {
    this.tables = initialData ? structuredClone(initialData) : {}
  }

  /** Start a query chain */
  from(table: string): MockQueryBuilder {
    if (!this.tables[table]) this.tables[table] = []
    return new MockQueryBuilder(this, table)
  }

  /** Mock RPC calls */
  async rpc(fnName: string, params?: any) {
    const handler = this._rpcHandlers[fnName]
    if (handler) return handler(params)
    return { data: [], error: null, count: null }
  }

  // ─── Inspection helpers for assertions ─────────────────────────

  getInserts(table?: string) {
    return table ? this._insertLog.filter(e => e.table === table) : this._insertLog
  }
  getUpdates(table?: string) {
    return table ? this._updateLog.filter(e => e.table === table) : this._updateLog
  }
  getUpserts(table?: string) {
    return table ? this._upsertLog.filter(e => e.table === table) : this._upsertLog
  }
  getDeletes(table?: string) {
    return table ? this._deleteLog.filter(e => e.table === table) : this._deleteLog
  }
  getTableData(table: string): any[] {
    return this.tables[table] || []
  }

  registerRpc(fnName: string, handler: (params: any) => any) {
    this._rpcHandlers[fnName] = handler
  }

  /** Push a row into the in-memory store (used internally by insert) */
  _pushRow(table: string, row: any) {
    if (!this.tables[table]) this.tables[table] = []
    const withDefaults = {
      id: row.id ?? String(this._nextId++),
      created_at: row.created_at ?? new Date().toISOString(),
      ...row,
    }
    this.tables[table].push(withDefaults)
    return withDefaults
  }

  _logInsert(table: string, data: any) { this._insertLog.push({ table, data }) }
  _logUpdate(table: string, data: any, match: Record<string, any>) { this._updateLog.push({ table, data, match }) }
  _logUpsert(table: string, data: any) { this._upsertLog.push({ table, data }) }
  _logDelete(table: string, match: Record<string, any>) { this._deleteLog.push({ table, data: null, match }) }

  /** Reset all data and logs */
  reset(data?: TableData) {
    this.tables = data ? structuredClone(data) : {}
    this._insertLog = []
    this._updateLog = []
    this._upsertLog = []
    this._deleteLog = []
    this._rpcHandlers = {}
    this._nextId = 10000
  }
}

// ─── Filter types ──────────────────────────────────────────────────────

type FilterOp = 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'is' | 'not_is' | 'not_eq' | 'like' | 'ilike' | 'contains'
type Filter = { field: string; op: FilterOp; value: any }

// ─── MockQueryBuilder ──────────────────────────────────────────────────

export class MockQueryBuilder {
  private client: MockSupabaseClient
  private table: string
  private filters: Filter[] = []
  private _orderBy: { field: string; ascending: boolean }[] = []
  private _limit: number | null = null
  private _offset: number | null = null
  private _select: string = '*'
  private _count: string | null = null
  private _head = false

  // Mutation state
  private _op: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select'
  private _mutationData: any = null
  private _upsertOpts: any = null
  private _returning = false

  constructor(client: MockSupabaseClient, table: string) {
    this.client = client
    this.table = table
  }

  // ─── Select / Count ────────────────────────────────────────────

  select(columns?: string, opts?: { count?: string; head?: boolean }) {
    this._select = columns || '*'
    if (opts?.count) this._count = opts.count
    if (opts?.head) this._head = true
    return this
  }

  // ─── Filters (all return `this` for chaining) ─────────────────

  eq(field: string, value: any) { this.filters.push({ field, op: 'eq', value }); return this }
  neq(field: string, value: any) { this.filters.push({ field, op: 'neq', value }); return this }
  gt(field: string, value: any) { this.filters.push({ field, op: 'gt', value }); return this }
  gte(field: string, value: any) { this.filters.push({ field, op: 'gte', value }); return this }
  lt(field: string, value: any) { this.filters.push({ field, op: 'lt', value }); return this }
  lte(field: string, value: any) { this.filters.push({ field, op: 'lte', value }); return this }
  like(field: string, value: any) { this.filters.push({ field, op: 'like', value }); return this }
  ilike(field: string, value: any) { this.filters.push({ field, op: 'ilike', value }); return this }
  contains(field: string, value: any) { this.filters.push({ field, op: 'contains', value }); return this }

  in(field: string, values: any[]) { this.filters.push({ field, op: 'in', value: values }); return this }
  is(field: string, value: any) { this.filters.push({ field, op: 'is', value }); return this }

  not(field: string, op: string, value: any) {
    this.filters.push({ field, op: `not_${op}` as FilterOp, value })
    return this
  }

  or(_condition: string) {
    // Simplified: or() is hard to simulate fully — just pass through for now
    return this
  }

  // ─── Order / Limit / Range ────────────────────────────────────

  order(field: string, opts?: { ascending?: boolean }) {
    this._orderBy.push({ field, ascending: opts?.ascending ?? true })
    return this
  }

  limit(n: number) { this._limit = n; return this }
  range(from: number, to: number) { this._offset = from; this._limit = to - from + 1; return this }

  // ─── Mutations ────────────────────────────────────────────────

  insert(data: any) {
    this._op = 'insert'
    this._mutationData = data
    return this
  }

  update(data: any) {
    this._op = 'update'
    this._mutationData = data
    return this
  }

  upsert(data: any, opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
    this._op = 'upsert'
    this._mutationData = data
    this._upsertOpts = opts
    return this
  }

  delete() {
    this._op = 'delete'
    return this
  }

  // ─── Terminal methods ─────────────────────────────────────────

  async single(): Promise<{ data: any; error: any }> {
    const result = await this._execute()
    if (result.error) return result
    const rows = result.data
    if (!rows || rows.length === 0) {
      return { data: null, error: { message: 'Row not found', code: 'PGRST116' } }
    }
    if (rows.length > 1) {
      return { data: null, error: { message: 'Multiple rows returned', code: 'PGRST102' } }
    }
    return { data: rows[0], error: null }
  }

  async maybeSingle(): Promise<{ data: any; error: any }> {
    const result = await this._execute()
    if (result.error) return result
    const rows = result.data
    if (!rows || rows.length === 0) return { data: null, error: null }
    if (rows.length > 1) {
      return { data: null, error: { message: 'Multiple rows returned', code: 'PGRST102' } }
    }
    return { data: rows[0], error: null }
  }

  /** Bare await — returns { data: rows[], error, count } */
  then(resolve: (value: any) => void, reject?: (reason: any) => void) {
    return this._execute().then(resolve, reject)
  }

  // ─── Execution engine ─────────────────────────────────────────

  private async _execute(): Promise<{ data: any; error: any; count?: number | null }> {
    const tableRows = this.client.tables[this.table] || []

    switch (this._op) {
      case 'select': {
        let rows = this._applyFilters(tableRows)
        rows = this._applyOrder(rows)
        if (this._offset) rows = rows.slice(this._offset)
        if (this._limit !== null) rows = rows.slice(0, this._limit)

        if (this._head) {
          return { data: null, error: null, count: rows.length }
        }
        return { data: rows, error: null, count: rows.length }
      }

      case 'insert': {
        const items = Array.isArray(this._mutationData) ? this._mutationData : [this._mutationData]
        const inserted: any[] = []
        for (const item of items) {
          const row = this.client._pushRow(this.table, item)
          inserted.push(row)
          this.client._logInsert(this.table, row)
        }
        return { data: inserted, error: null }
      }

      case 'update': {
        const matching = this._applyFilters(tableRows)
        const filterMap = this._buildFilterMap()

        for (const row of matching) {
          Object.assign(row, this._mutationData, { updated_at: new Date().toISOString() })
        }
        this.client._logUpdate(this.table, this._mutationData, filterMap)
        return { data: matching, error: null }
      }

      case 'upsert': {
        const items = Array.isArray(this._mutationData) ? this._mutationData : [this._mutationData]
        const result: any[] = []
        for (const item of items) {
          // Try to find existing row by conflict key or id
          const conflictKey = this._upsertOpts?.onConflict?.split(',')[0] || 'id'
          const existing = tableRows.find(r => r[conflictKey] === item[conflictKey])
          if (existing) {
            Object.assign(existing, item, { updated_at: new Date().toISOString() })
            result.push(existing)
          } else {
            const row = this.client._pushRow(this.table, item)
            result.push(row)
          }
          this.client._logUpsert(this.table, item)
        }
        return { data: result, error: null }
      }

      case 'delete': {
        const toDelete = this._applyFilters(tableRows)
        const filterMap = this._buildFilterMap()
        const ids = new Set(toDelete.map(r => r.id))
        this.client.tables[this.table] = tableRows.filter(r => !ids.has(r.id))
        this.client._logDelete(this.table, filterMap)
        return { data: toDelete, error: null }
      }

      default:
        return { data: null, error: { message: `Unknown op: ${this._op}` } }
    }
  }

  // ─── Filter evaluation ────────────────────────────────────────

  private _applyFilters(rows: any[]): any[] {
    return rows.filter(row => this.filters.every(f => this._matchFilter(row, f)))
  }

  private _matchFilter(row: any, filter: Filter): boolean {
    const val = this._resolveField(row, filter.field)

    switch (filter.op) {
      case 'eq': return val === filter.value
      case 'neq': return val !== filter.value
      case 'gt': return val > filter.value
      case 'gte': return val >= filter.value
      case 'lt': return val < filter.value
      case 'lte': return val <= filter.value
      case 'in': return Array.isArray(filter.value) && filter.value.includes(val)
      case 'is':
        if (filter.value === null) return val === null || val === undefined
        return val === filter.value
      case 'not_is':
        if (filter.value === null) return val !== null && val !== undefined
        return val !== filter.value
      case 'not_eq': return val !== filter.value
      case 'like': return typeof val === 'string' && new RegExp(filter.value.replace(/%/g, '.*')).test(val)
      case 'ilike': return typeof val === 'string' && new RegExp(filter.value.replace(/%/g, '.*'), 'i').test(val)
      case 'contains': return Array.isArray(val) && filter.value.every((v: any) => val.includes(v))
      default: return true
    }
  }

  /**
   * Resolve field name — supports Supabase JSONB arrow syntax:
   *   "metadata->>chat_id"  → row.metadata?.chat_id
   *   "metadata->settings"  → row.metadata?.settings (as object)
   */
  private _resolveField(row: any, field: string): any {
    if (field.includes('->>')) {
      const [obj, key] = field.split('->>')
      return row[obj]?.[key]
    }
    if (field.includes('->')) {
      const [obj, key] = field.split('->')
      return row[obj]?.[key]
    }
    return row[field]
  }

  // ─── Order evaluation ─────────────────────────────────────────

  private _applyOrder(rows: any[]): any[] {
    if (this._orderBy.length === 0) return rows
    return [...rows].sort((a, b) => {
      for (const { field, ascending } of this._orderBy) {
        const aVal = a[field]
        const bVal = b[field]
        if (aVal === bVal) continue
        if (aVal == null) return ascending ? -1 : 1
        if (bVal == null) return ascending ? 1 : -1
        const cmp = aVal < bVal ? -1 : 1
        return ascending ? cmp : -cmp
      }
      return 0
    })
  }

  /** Build a simple key-value map from eq filters (for logging) */
  private _buildFilterMap(): Record<string, any> {
    const map: Record<string, any> = {}
    for (const f of this.filters) {
      if (f.op === 'eq') map[f.field] = f.value
    }
    return map
  }
}

// ─── Factory ───────────────────────────────────────────────────────────

export function createMockSupabaseClient(data?: TableData): MockSupabaseClient {
  return new MockSupabaseClient(data)
}
