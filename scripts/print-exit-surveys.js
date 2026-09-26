#!/usr/bin/env node
import { readFile } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const storageFile = path.join(__dirname, '..', 'test-results', 'exit-surveys.jsonl')

async function main() {
  const raw = await readFile(storageFile, { encoding: 'utf8' }).catch(() => '')
  const lines = raw.split('\n').filter(Boolean)
  if (!lines.length) {
    console.log('No exit survey entries found.')
    return
  }
  const items = lines.map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  // Print last 25 entries
  const last = items.slice(-25)
  for (const it of last) {
    console.log('---')
    console.log(new Date(it.receivedAt || it.timestamp).toLocaleString())
    console.log('Q1:', it.q1)
    console.log('Q2:', it.q2)
    if (it.comment) console.log('Comment:', it.comment)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
