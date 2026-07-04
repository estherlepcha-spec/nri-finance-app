import { readFileSync, writeFileSync, existsSync } from 'fs'
import { resolve } from 'path'

const DATA_FILE = resolve(process.cwd(), 'sync-data.json')

function getData() {
  if (!existsSync(DATA_FILE)) return {}
  try { return JSON.parse(readFileSync(DATA_FILE, 'utf8')) } catch { return {} }
}

function saveData(d) {
  try { writeFileSync(DATA_FILE, JSON.stringify(d)) } catch { /* ignore write errors */ }
}

export function syncServerPlugin() {
  let sseClients = []

  function broadcast(payload) {
    const msg = `data: ${JSON.stringify(payload)}\n\n`
    sseClients = sseClients.filter(res => {
      try { res.write(msg); return true } catch { return false }
    })
  }

  return {
    name: 'nri-sync-server',
    configureServer(server) {
      server.middlewares.use('/api/sync', (req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*')
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        res.setHeader('Cache-Control', 'no-store')

        if (req.method === 'OPTIONS') {
          res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
          res.writeHead(200); res.end(); return
        }

        // SSE: real-time push to all connected devices
        if (req.method === 'GET' && req.headers.accept?.includes('text/event-stream')) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Connection': 'keep-alive',
            'X-Accel-Buffering': 'no',
          })
          // Send all current data immediately on connect
          res.write(`data: ${JSON.stringify({ type: 'init', data: getData() })}\n\n`)
          sseClients.push(res)
          req.on('close', () => { sseClients = sseClients.filter(c => c !== res) })
          return
        }

        // REST GET: pull current snapshot
        if (req.method === 'GET') {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true, data: getData() })); return
        }

        // REST POST: push updates from a device
        if (req.method === 'POST') {
          let body = ''
          req.on('data', c => { body += c })
          req.on('end', () => {
            try {
              const { deviceId, updates } = JSON.parse(body)
              const data = getData()
              Object.assign(data, updates)
              saveData(data)
              broadcast({ type: 'update', deviceId, updates })
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ ok: true }))
            } catch (e) {
              res.writeHead(400)
              res.end(JSON.stringify({ ok: false, error: e.message }))
            }
          }); return
        }

        res.writeHead(404); res.end()
      })
    },
  }
}
