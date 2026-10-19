import { createLab } from './lab.ts'

// The lab as its own process: LAB_DIR is where it keeps its files, GATEWAY_URL where the payment gateway is.
const dir = process.env.LAB_DIR
const gatewayUrl = process.env.GATEWAY_URL
if (!dir || !gatewayUrl) {
  console.error('LAB_DIR and GATEWAY_URL are needed')
  process.exit(1)
}
const lab = createLab({ dir, gatewayUrl })
console.log(JSON.stringify({ port: await lab.listen() }))
// The harness closes our stdin to say "finish", and it closes with it if the harness dies: either way, go.
const finish = () => void lab.close().then(() => process.exit(0))
process.on('SIGTERM', finish)
process.stdin.on('end', finish)
process.stdin.resume()
