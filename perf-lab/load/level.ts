import { measure } from './measure.ts'
import type { Plan } from './measure.ts'

// One level of a run, in a process of its own, so that if anything in it dies the harness only has to try the level again:
//   node level.ts '{"load":100,"dir":"/tmp/a-new-folder","warmup":3,"duration":20,"gatewayDelay":90,"seed":1}'
// It prints the level as a line of JSON. Its stdin is a pipe from run.ts; if that closes, run.ts is gone, and so are we
// (which closes the pipes to the gateway and the lab, and they go too).
process.stdin.on('end', () => process.exit(1))
process.stdin.resume()

const { load, dir, ...plan } = JSON.parse(process.argv[2] ?? '{}') as { load: number; dir: string } & Plan
console.log(JSON.stringify(await measure(load, dir, plan)))
process.exit(0)
