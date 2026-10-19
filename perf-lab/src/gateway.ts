import { createServer } from 'node:http'

/**
 * A stand-in for a payment provider, run as its own process. Each call takes about GATEWAY_DELAY_MS (90 by default,
 * give or take a quarter), and once more than GATEWAY_LIMIT calls (100 by default) have come in within the last
 * second it answers 429 straight away, the way a real provider rate-limits. The lab's harness starts it.
 */
const delay = Number(process.env.GATEWAY_DELAY_MS ?? 90)
const limit = Number(process.env.GATEWAY_LIMIT ?? 100)

const recent: number[] = []

const server = createServer((req, res) => {
  req.resume() // the body is not needed
  const now = Date.now()
  while (recent.length > 0 && recent[0] <= now - 1000) recent.shift()
  if (recent.length >= limit) {
    res.writeHead(429).end()
    return
  }
  recent.push(now)
  setTimeout(() => res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}'), delay * (0.75 + Math.random() * 0.5))
})

server.listen(0, '127.0.0.1', () => {
  const address = server.address()
  console.log(JSON.stringify({ port: typeof address === 'object' && address ? address.port : 0 }))
})
// The harness closes our stdin to say "finish", and it closes with it if the harness dies: either way, go.
process.on('SIGTERM', () => process.exit(0))
process.stdin.on('end', () => process.exit(0))
process.stdin.resume()
