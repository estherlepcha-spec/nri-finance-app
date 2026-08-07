// Real-time sync via the Vite dev server's /api/sync endpoint.
// Uses Server-Sent Events for push, fetch POST for writes.

const SYNC_SHARED_TOKEN = import.meta.env.VITE_SYNC_SHARED_TOKEN || ''
const SYNC_QUERY = SYNC_SHARED_TOKEN ? `?token=${encodeURIComponent(SYNC_SHARED_TOKEN)}` : ''

const DEVICE_ID = (() => {
  let id = localStorage.getItem('nri_deviceId')
  if (!id) { id = Math.random().toString(36).slice(2, 10); localStorage.setItem('nri_deviceId', id) }
  return id
})()

const SYNC_KEYS = [
  'nri_setupComplete', 'nri_homeCurrency', 'nri_foreignCurrency', 'nri_primaryCurrency',
  'nri_exchangeRate', 'nri_accounts', 'nri_transactions', 'nri_bills', 'nri_remittances',
  'nri_investments', 'nri_goals', 'nri_goalContribs', 'nri_allocations', 'nri_loans',
  'nri_family', 'nri_templates', 'nri_wkBudgets', 'nri_hmBudgets', 'nri_budgetMonth',
  'nri_savedScenarios', 'nri_lastImport', 'nri_smartRules', 'nri_onboardedAt',
]

let _onStatus = null
let _onRemote = null
let _es = null
let _writeQueue = {}
let _writeTimer = null
let _available = false
const DEBOUNCE = 800
const RECONNECT_DELAY = 4000

function base() { return window.location.origin }

export function deviceId() { return DEVICE_ID }

export function isAvailable() { return _available }

export async function init(onStatus, onRemote) {
  _onStatus = onStatus
  _onRemote = onRemote

  // Verify the sync endpoint exists before committing
  try {
    const r = await fetch(`${base()}/api/sync${SYNC_QUERY}`, {
      signal: AbortSignal.timeout(2000),
      headers: SYNC_SHARED_TOKEN ? { Authorization: `Bearer ${SYNC_SHARED_TOKEN}` } : {},
    })
    if (!r.ok) { onStatus('unavailable'); return }
    _available = true
  } catch (err) {
    console.warn('Sync endpoint unavailable', err)
    onStatus('unavailable'); return
  }

  connect()
}

function connect() {
  _es?.close()
  try {
    _es = new EventSource(`${base()}/api/sync${SYNC_QUERY}`)

    _es.onopen = () => _onStatus?.('synced')

    _es.onmessage = e => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type === 'init') {
          // Initial state from server — but don't overwrite local data with empty server state
          applyFiltered(msg.data, true)
          _onStatus?.('synced')
        } else if (msg.type === 'update') {
          // Only apply if update came from a different device
          if (msg.deviceId !== DEVICE_ID) {
            applyFiltered(msg.updates)
            _onStatus?.('synced')
          }
        }
      } catch (err) {
        console.warn('Sync message parse failed', err)
      }
    }

    _es.onerror = () => {
      _es.close()
      _onStatus?.('offline')
      setTimeout(connect, RECONNECT_DELAY)
    }
  } catch (err) {
    console.warn('Sync connection failed', err)
    _onStatus?.('offline')
    setTimeout(connect, RECONNECT_DELAY)
  }
}

function isEmpty(val) {
  if (val === null || val === undefined) return true
  if (Array.isArray(val)) return val.length === 0
  if (typeof val === 'object') return Object.keys(val).length === 0
  return false
}

function applyFiltered(data, isInit = false) {
  if (!data || !_onRemote) return
  const filtered = {}
  SYNC_KEYS.forEach(k => {
    if (!(k in data)) return
    const serverVal = data[k]
    if (isInit && isEmpty(serverVal)) {
      // Server has empty data (restarted) — keep local localStorage value instead
      try {
        const local = localStorage.getItem(k)
        if (local) {
          const parsed = JSON.parse(local)
          if (!isEmpty(parsed)) return // skip — keep local data
        }
      } catch (err) {
        console.warn('Failed to read local sync cache', err)
      }
    }
    filtered[k] = serverVal
  })
  if (Object.keys(filtered).length) _onRemote(filtered)
}

export function push(key, value) {
  if (!_available) return
  _writeQueue[key] = value
  clearTimeout(_writeTimer)
  _writeTimer = setTimeout(flush, DEBOUNCE)
  _onStatus?.('syncing')
}

async function flush() {
  if (!_available || !Object.keys(_writeQueue).length) return
  const batch = { ..._writeQueue }
  _writeQueue = {}
  try {
    await fetch(`${base()}/api/sync${SYNC_QUERY}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(SYNC_SHARED_TOKEN ? { Authorization: `Bearer ${SYNC_SHARED_TOKEN}` } : {}),
      },
      body: JSON.stringify({ deviceId: DEVICE_ID, updates: batch }),
    })
    _onStatus?.('synced')
  } catch (err) {
    console.warn('Sync push failed', err)
    _onStatus?.('offline')
  }
}
