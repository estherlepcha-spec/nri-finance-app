#!/usr/bin/env node
import http from 'http'
import { appendFile, readFile } from 'fs/promises'
import { fileURLToPath } from 'url'
import path from 'path'

const PORT = process.env.EXIT_SURVEY_PORT || 4001
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const storageFile = path.join(__dirname, '..', 'test-results', 'exit-surveys.jsonl')

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    })
    return res.end()
  }

  if (req.method === 'POST' && req.url === '/api/exit-survey') {
    let body = ''
    try {
      for await (const chunk of req) body += chunk
      const obj = JSON.parse(body || '{}')
      const line = JSON.stringify({ receivedAt: new Date().toISOString(), ...obj }) + '\n'
      await appendFile(storageFile, line, { encoding: 'utf8' })
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*' })
      return res.end()
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
      return res.end(JSON.stringify({ error: 'invalid_json', message: String(e) }))
    }
  }

  if (req.method === 'GET' && req.url === '/api/exit-surveys') {
    try {
      const contents = await readFile(storageFile, { encoding: 'utf8' }).catch(() => '')
      const lines = contents.split('\n').filter(Boolean)
      const items = lines.map(l => {
        try { return JSON.parse(l) } catch { return null }
      }).filter(Boolean)
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
      return res.end(JSON.stringify(items))
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
      return res.end(JSON.stringify({ error: String(e) }))
    }
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' })
  res.end('Not found')
})

server.listen(PORT, () => console.log(`Exit survey server listening on http://localhost:${PORT}`))
