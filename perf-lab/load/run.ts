import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { ID_RULE, isValidId } from '../../src/core/model.ts'
import { knee } from '../../src/core/perf/analyse.ts'
import { parseRun } from '../../src/core/perf/parse.ts'
import { kneeText } from '../../src/core/perf/text.ts'
import type { Level } from '../../src/core/perf/types.ts'
import type { Plan } from './measure.ts'
import { formatRun } from './write-run.ts'

const here = import.meta.dirname

/** How many times a level is tried before the run gives up. */
const ATTEMPTS = 3

/**
 * One level, measured by `level.ts` in a process of its own. Heavy load has been seen, rarely, to stop one of the
 * processes on Windows (exit code 3221226505) with nothing said, and a stopped level is cheaper to try again than a
 * whole run. Its stdin is a pipe from here, so if this process goes, it goes too.
 */
async function levelInAProcess(load: number, plan: Plan): Promise<Level> {
  // The lab's files go in a new folder for each try. It is removed here, because a level that was stopped cannot do it.
  const dir = await mkdtemp(join(tmpdir(), 'perf-lab-'))
  try {
    return await new Promise<Level>((resolveLevel, reject) => {
      const child = spawn(process.execPath, ['--no-warnings', join(here, 'level.ts'), JSON.stringify({ load, dir, ...plan })], {
        stdio: ['pipe', 'pipe', 'inherit'],
      })
      child.stdin.on('error', () => {})
      let out = ''
      child.stdout.on('data', chunk => (out += chunk))
      child.on('error', reject)
      // 'close', not 'exit': it comes after everything the process printed has been read.
      child.on('close', (code, signal) => {
        if (code !== 0) return reject(new Error(`that level stopped (exit code ${code ?? signal}; what stopped it is above)`))
        try {
          resolveLevel(JSON.parse(out) as Level)
        } catch {
          reject(new Error('that level printed no result'))
        }
      })
    })
  } finally {
    // Its gateway and lab may still be closing their files, which on Windows keeps the folder from being removed for a moment.
    await rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 })
  }
}

/** A number from the command line, at least `min`, or an error that names the flag. */
function amount(flag: string, text: string, min: number): number {
  const n = Number(text)
  if (text.trim() === '' || !Number.isFinite(n) || n < min) throw new Error(`--${flag} needs a number of ${min} or more, not "${text}"`)
  return n
}

/** A run's id as a name: "slow-gateway" is "Slow gateway". */
const titleOf = (id: string): string => {
  const words = id.replaceAll('-', ' ')
  return words[0].toUpperCase() + words.slice(1)
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      levels: { type: 'string', default: '10,25,50,100,200,400' },
      duration: { type: 'string', default: '20' },
      warmup: { type: 'string', default: '3' },
      name: { type: 'string', default: 'ramp' },
      'gateway-delay': { type: 'string', default: '90' },
      about: { type: 'string', default: '' },
      out: { type: 'string' },
      seed: { type: 'string', default: '1' },
    },
  })
  const loads = values.levels!.split(',').map(Number)
  if (loads.length < 2 || loads.some((n, i) => !Number.isFinite(n) || n <= 0 || (i > 0 && n <= loads[i - 1])))
    throw new Error('--levels needs two or more positive numbers, each above the one before, like 10,50,100')
  const name = values.name!
  if (!isValidId(name)) throw new Error(`--name must be a run id: ${ID_RULE}`)
  const out = resolve(values.out ?? join(here, '../flowy/perf', `${name}.yaml`))
  const plan: Plan = {
    duration: amount('duration', values.duration!, 1),
    warmup: amount('warmup', values.warmup!, 0),
    gatewayDelay: amount('gateway-delay', values['gateway-delay']!, 0),
    seed: amount('seed', values.seed!, 0),
  }

  const levels: Level[] = []
  const retried: number[] = []
  for (const load of loads) {
    for (let attempt = 1; ; attempt++) {
      console.log(`${load} req/s: ${plan.warmup} s warm-up, then ${plan.duration} s measured${attempt > 1 ? ` (try ${attempt} of ${ATTEMPTS})` : ''}`)
      try {
        levels.push(await levelInAProcess(load, plan))
        if (attempt > 1) retried.push(load)
        break
      } catch (e) {
        const why = e instanceof Error ? e.message : String(e)
        if (attempt === ATTEMPTS) throw new Error(`${load} req/s failed ${ATTEMPTS} times; the last time: ${why}`)
        console.log(`  ${why}; starting that level again`)
      }
    }
  }

  // A level that took a second try says so in the run: the numbers are real, but a process had stopped once before them.
  const again = retried.length === 0 ? '' : ` The ${retried.join(', ')} req/s level${retried.length > 1 ? 's were' : ' was'} measured on a later try, after a process stopped.`
  const about = values.about || `Made by perf-lab on one machine: ${plan.duration} s measured at each level after ${plan.warmup} s of warm-up, a fresh lab for each level, open-loop, gateway about ${plan.gatewayDelay} ms. Absolute numbers belong to that machine.${again}`
  const text = formatRun({ name: titleOf(name), about, unit: 'req/s', entry: 'shopper' }, levels)
  const { run } = parseRun(name, text) // before anything is written: a run that can't be played is not worth a file
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, text)
  const k = knee(run)
  console.log(`wrote ${out}`)
  console.log(k ? kneeText(run, k, id => id) : 'It never struggled in the tested range.')
}

await main()
