/**
 * Records the animations in docs/images/anim: one for each feature the README shows, in a light and a dark theme.
 *
 *     npm run build
 *     npm install --no-save puppeteer-core
 *     node docs/images/record.mjs            # all of them
 *     node docs/images/record.mjs flows data # some of them
 *
 * Each one is the browser canvas on a throwaway copy of the Plum demo, driven by a script in headless Chrome (no window opens), then cut
 * into an animated WebP by ffmpeg. Needs ffmpeg on the PATH and Chrome or Edge (CHROME names the browser if it isn't found).
 * FORMAT=gif writes GIFs instead, about four times the size. The story of each one is its entry in `scenes` below. Retake them when the
 * canvas moves or looks different, and look at both themes before you commit.
 */
import puppeteer from 'puppeteer-core'
import { spawn, execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const outDir = join(here, 'anim')
const WIDTH = 1200
const HEIGHT = 760
const FORMAT = process.env.FORMAT === 'gif' ? 'gif' : 'webp'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const ease = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)

function findBrowser() {
  const found = [
    process.env.CHROME,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].find(p => p && existsSync(p))
  if (found) return found
  const cache = join(homedir(), '.cache', 'puppeteer', 'chrome')
  if (existsSync(cache)) for (const v of readdirSync(cache)) for (const exe of ['chrome-win64/chrome.exe', 'chrome-linux64/chrome']) if (existsSync(join(cache, v, exe))) return join(cache, v, exe)
  throw new Error('No Chrome or Edge found: set CHROME to its path')
}

/** What the page gets: a cursor that follows the mouse, a ring where it clicks, and a name for each step, in the empty middle of the top bar. */
const overlay = () => {
  const css = document.createElement('style')
  css.textContent = `
    #reel-cursor{position:fixed;left:0;top:0;width:28px;height:28px;z-index:99999;pointer-events:none;transform:translate(-100px,-100px);filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))}
    .reel-ripple{position:fixed;z-index:99998;pointer-events:none;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;border:3px solid #2563eb;animation:reel-ripple .55s ease-out forwards}
    @keyframes reel-ripple{from{transform:scale(.4);opacity:.95}to{transform:scale(3.6);opacity:0}}
    #reel-cap{position:fixed;left:50%;top:4px;z-index:99999;pointer-events:none;transform:translate(-50%,-6px);opacity:0;transition:opacity .25s,transform .25s;white-space:nowrap;
      background:rgba(20,24,40,.9);color:#fff;font:600 19px/1 "Segoe UI",system-ui,sans-serif;padding:9px 20px;border-radius:999px;box-shadow:0 4px 14px rgba(0,0,0,.22)}
    #reel-cap.on{opacity:1;transform:translate(-50%,0)}
    @media (prefers-color-scheme:dark){#reel-cap{background:rgba(238,242,255,.94);color:#111827}.reel-ripple{border-color:#60a5fa}}`
  document.head.append(css)
  const cur = document.createElement('div')
  cur.id = 'reel-cursor'
  cur.innerHTML = '<svg width="28" height="28" viewBox="0 0 28 28"><path d="M5 3l16 9.5-7 1.7-3.6 6.6z" fill="#fff" stroke="#111" stroke-width="1.6" stroke-linejoin="round"/></svg>'
  const cap = document.createElement('div')
  cap.id = 'reel-cap'
  document.body.append(cur, cap)
  addEventListener('mousemove', e => { cur.style.transform = `translate(${e.clientX - 5}px,${e.clientY - 3}px)` }, true)
  addEventListener('mousedown', e => {
    const r = document.createElement('div')
    r.className = 'reel-ripple'
    r.style.left = e.clientX + 'px'
    r.style.top = e.clientY + 'px'
    document.body.append(r)
    setTimeout(() => r.remove(), 700)
  }, true)
}

/** The moves a story can make. A story starts on the view the scene names and should end where it began, so the loop reads as one. */
function driver(page) {
  const pos = { x: WIDTH * 0.7, y: HEIGHT * 0.5 }
  const d = {
    page,
    pos,
    node: id => `.react-flow__node[data-id="${id}"]`,
    wait: sleep,
    async glide(x, y, ms = 600) {
      const steps = Math.max(2, Math.round(ms / 16))
      const { x: x0, y: y0 } = pos
      for (let i = 1; i <= steps; i++) {
        const t = ease(i / steps)
        await page.mouse.move(x0 + (x - x0) * t, y0 + (y - y0) * t)
        await sleep(16)
      }
      pos.x = x
      pos.y = y
    },
    /** The middle of an element. One that sits below the fold of a panel is scrolled to first, smoothly, as a reader's wheel would. */
    async centre(sel) {
      const measure = () => page.$eval(sel, el => { const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2] })
      let at = await measure()
      if (at[1] > HEIGHT - 70 || at[1] < 60) {
        await page.$eval(sel, el => el.scrollIntoView({ block: 'center', behavior: 'smooth' }))
        await sleep(800)
        at = await measure()
      }
      return at
    },
    async aim(sel, ms) { const [x, y] = await d.centre(sel); await d.glide(x, y, ms) },
    park: (ms = 450) => d.glide(1110, 700, ms), // an empty corner, so no shape shows its tooltip
    async click(sel, ms = 600) { await d.aim(sel, ms); await sleep(120); await page.mouse.down({ clickCount: 1 }); await sleep(60); await page.mouse.up({ clickCount: 1 }) },
    async dblclick(sel, ms = 600) {
      await d.aim(sel, ms); await sleep(120)
      await page.mouse.down({ clickCount: 1 }); await sleep(40); await page.mouse.up({ clickCount: 1 }); await sleep(90)
      await page.mouse.down({ clickCount: 2 }); await sleep(40); await page.mouse.up({ clickCount: 2 })
    },
    /** Press on one shape and let go on another, which is how a line is drawn in edit mode. */
    async drag(fromSel, toSel, ms = 600) {
      await d.aim(fromSel, ms); await sleep(150)
      await page.mouse.down()
      await d.aim(toSel, 650); await sleep(250)
      await page.mouse.up()
    },
    async type(text) { await page.keyboard.type(text, { delay: 55 }) },
    key: k => page.keyboard.press(k),
    go: hash => page.evaluate(h => { location.hash = h }, hash),
    caption: text => page.evaluate(t => {
      const c = document.getElementById('reel-cap')
      if (t) { c.textContent = t; c.classList.add('on') } else c.classList.remove('on')
    }, text),
  }
  return d
}

const down = id => `.react-flow__node[data-id="${id}"] .react-flow__handle-bottom`

const scenes = {
  // Overview into Ordering and Order API, back out, sideways to Delivery and into Dispatch, and back to the overview.
  zoom: {
    async story(s) {
      await s.glide(560, 420, 450); await s.wait(250)
      await s.caption('Zoom in')
      await s.dblclick(s.node('ordering'), 500); await s.park(); await s.wait(700)
      await s.dblclick(s.node('order-api'), 500); await s.park(); await s.wait(1000)
      await s.caption('Zoom out')
      await s.key('Escape'); await s.wait(1000)
      await s.caption('Zoom sideways')
      await s.dblclick(s.node('delivery'), 600); await s.park(); await s.wait(1100)
      await s.caption('Zoom in')
      await s.dblclick(s.node('dispatch'), 600); await s.park(); await s.wait(1300)
      await s.caption('Zoom out')
      await s.key('Escape'); await s.wait(900)
      await s.key('Escape'); await s.wait(1600)
    },
  },
  // A flow with a retry that times out, then a branch.
  flows: {
    hash: '#ordering',
    async story(s) {
      await s.wait(500)
      await s.caption('Play a flow')
      await s.key('l'); await s.wait(500)
      await s.click('::-p-text(The payment is captured)', 700); await s.park(); await s.wait(300)
      await s.key('l'); await s.wait(1500)
      for (let step = 0; step < 5; step++) { await s.key('ArrowRight'); await s.wait(step === 4 ? 2200 : 1500) }
      await s.caption(null)
      await s.key('Escape'); await s.wait(1000)
    },
  },
  // A load test stepped up from 100 to 1200 orders a minute, then a click for one shape's numbers.
  performance: {
    hash: '#delivery',
    async story(s) {
      await s.wait(600)
      await s.caption('Replay a load test')
      await s.key('t'); await s.wait(800)
      await s.key('Home'); await s.wait(1300)
      for (let level = 0; level < 4; level++) { await s.key('ArrowRight'); await s.wait(level === 3 ? 1500 : 1300) }
      await s.caption('Click a shape')
      await s.click(s.node('dispatch'), 700); await s.park(); await s.wait(2600)
      await s.caption(null)
      await s.key('Escape'); await s.wait(500)
      await s.key('Escape'); await s.wait(900)
    },
  },
  // Two failure modes picked from the list, then the flow that tells one of them.
  failures: {
    hash: '#ordering',
    async story(s) {
      await s.wait(500)
      await s.caption('Pick a failure mode')
      await s.key('m'); await s.wait(1000)
      await s.click('::-p-text(Orders DB is unavailable)', 700); await s.wait(1700)
      await s.click('::-p-text(Stripe doesn)', 600); await s.wait(1900)
      await s.caption('Play how it fails')
      await s.click('::-p-text(Show it)', 700); await s.park(); await s.wait(2600)
      await s.caption(null)
      await s.key('Escape'); await s.wait(600)
      await s.key('Escape'); await s.wait(900)
    },
  },
  // A store's tables, opened one after another.
  data: {
    hash: '#ordering',
    async story(s) {
      await s.wait(500)
      await s.caption('See what a store holds')
      await s.click(s.node('orders-db'), 800); await s.wait(2000)
      await s.click('::-p-text(order_items)', 700); await s.wait(1900)
      await s.click('::-p-text(Kept with its order)', 600); await s.wait(2200)
      await s.park(); await s.key('Escape'); await s.wait(900)
    },
  },
  // Draw a line, name it, add a shape, and try two shapes on it. Writes to the throwaway copy.
  edit: {
    hash: '#ordering',
    copy: true,
    async story(s) {
      await s.wait(500)
      await s.caption('Edit on the canvas')
      await s.key('e'); await s.wait(900)
      await s.caption('Draw a line')
      await s.drag(down('kitchen-tablet'), s.node('orders-db'), 600); await s.wait(700)
      await s.click('input', 500); await s.type('sends receipts'); await s.key('Enter'); await s.wait(1300)
      await s.caption('Add a shape')
      await s.click('::-p-text(Add)', 600); await s.wait(500)
      await s.click('input', 500); await s.type('Receipts'); await s.key('Enter'); await s.wait(1400)
      await s.caption('Change its look') // the new shape is already open in the panel
      await s.wait(500)
      await s.click('::-p-text(Diamond)', 700); await s.wait(1000)
      await s.click('::-p-text(Hexagon)', 500); await s.wait(2000)
      await s.park(); await s.caption(null); await s.wait(500)
    },
  },
  // An MCP client writes to the same folder, and the canvas redraws as each call lands.
  agents: {
    hash: '#order-api',
    copy: true,
    async story(s, { agent }) {
      await s.wait(900)
      await s.caption('put_object  promo-codes')
      await agent('put_object', { id: 'promo-codes', type: 'component', in: 'order-api', name: 'Promo codes', description: 'Checks a code and returns the discount.' }); await s.wait(1700)
      await s.caption('connect  pricing → promo-codes')
      await agent('connect', { from: 'pricing', to: 'promo-codes', label: 'checks codes' }); await s.wait(1900)
      await s.caption('put_object  loyalty')
      await agent('put_object', { id: 'loyalty', type: 'component', in: 'order-api', name: 'Loyalty points', description: 'Adds points when an order is paid.' }); await s.wait(1700)
      await s.caption('connect  checkout → loyalty')
      await agent('connect', { from: 'checkout', to: 'loyalty', label: 'adds points' }); await s.wait(2200)
      await s.caption(null); await s.wait(400)
    },
  },
}

/** A copy of Plum in a temp folder and a server on it, so nothing a story writes reaches the repo. */
async function serve(copy) {
  const base = mkdtempSync(join(tmpdir(), 'flowy-reel-'))
  const dir = copy ? join(base, 'demo', 'flowy') : join(root, 'docs', 'demo', 'flowy')
  if (copy) cpSync(join(root, 'docs', 'demo'), join(base, 'demo'), { recursive: true })
  const server = spawn(process.execPath, ['dist/cli.js', '--dir', dir, '--no-open'], {
    cwd: root, env: { ...process.env, FLOWY_STATE_DIR: join(base, 'state') }, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true,
  })
  const url = await new Promise((resolve, reject) => {
    server.on('exit', () => reject(new Error('The demo server stopped: run npm run build first')))
    server.stdout.on('data', chunk => { const m = /http:\/\/127\.0\.0\.1:\d+\//.exec(String(chunk)); if (m) resolve(m[0]) })
    setTimeout(() => reject(new Error('The demo server did not start')), 15000)
  })
  return { url, dir, stop: () => { server.kill(); rmSync(base, { recursive: true, force: true }) } }
}

/** The MCP server on the same folder, as an agent would use it. */
async function connectAgent(dir) {
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js')
  const client = new Client({ name: 'reel', version: '0.0.0' })
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(root, 'dist', 'cli.js'), 'mcp', '--dir', dir], cwd: root, stderr: 'ignore' }))
  return {
    call: async (tool, args) => {
      const res = await client.callTool({ name: tool, arguments: args })
      if (res.isError) throw new Error(`${tool} failed: ${JSON.stringify(res.content)}`)
    },
    close: () => client.close(),
  }
}

async function record(browser, name, scene, theme) {
  const site = await serve(scene.copy)
  const agent = scene.copy && name === 'agents' ? await connectAgent(site.dir) : undefined
  const frames = mkdtempSync(join(tmpdir(), 'flowy-reel-frames-'))
  let open = true // frames that arrive after a failed story must not write into a folder that is gone
  try {
    const page = await browser.newPage()
    await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 2 })
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }])
    await page.goto(site.url + (scene.hash ?? ''), { waitUntil: 'domcontentloaded' })
    await page.waitForSelector('.react-flow__node')
    await page.evaluate(overlay)
    const s = driver(page)
    await page.mouse.move(s.pos.x, s.pos.y)

    const shots = []
    const cdp = await page.createCDPSession()
    cdp.on('Page.screencastFrame', f => {
      if (!open) return
      const file = `f${String(shots.length).padStart(5, '0')}.png`
      writeFileSync(join(frames, file), Buffer.from(f.data, 'base64'))
      shots.push({ file, ts: f.metadata.timestamp })
      cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
    })
    await sleep(800)
    await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 })
    try {
      await scene.story(s, { agent: agent?.call })
    } catch (error) {
      const shot = join(tmpdir(), `flowy-reel-${name}-${theme}-failed.png`)
      await page.screenshot({ path: shot }).catch(() => {})
      throw new Error(`${name} failed (the page was left in ${shot}): ${error.message}`)
    }
    await sleep(250)
    await cdp.send('Page.stopScreencast')
    await page.close()

    const list = shots.map((f, i) => `file '${f.file}'\nduration ${(i + 1 < shots.length ? shots[i + 1].ts - f.ts : 0.15).toFixed(4)}`)
    list.push(`file '${shots.at(-1).file}'`)
    writeFileSync(join(frames, 'list.txt'), list.join('\n'))
    mkdirSync(outDir, { recursive: true })
    const out = join(outDir, `${name}-${theme}.${FORMAT}`)
    const input = ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(frames, 'list.txt')]
    if (FORMAT === 'webp') execFileSync('ffmpeg', [...input, '-vf', `fps=20,scale=${WIDTH}:-1:flags=lanczos`, '-c:v', 'libwebp_anim', '-quality', '85', '-compression_level', '6', '-loop', '0', out])
    else execFileSync('ffmpeg', [...input, '-vf', `fps=15,scale=${WIDTH}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`, out])
    console.log(`${name}-${theme}.${FORMAT}`)
  } finally {
    open = false
    await agent?.close()
    site.stop()
    rmSync(frames, { recursive: true, force: true })
  }
}

const wanted = process.argv.slice(2)
const unknown = wanted.filter(n => !scenes[n])
if (unknown.length) throw new Error(`No such animation: ${unknown.join(', ')}. They are ${Object.keys(scenes).join(', ')}`)
const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: true, args: ['--hide-scrollbars', '--force-color-profile=srgb'] })
try {
  for (const [name, scene] of Object.entries(scenes)) {
    if (wanted.length && !wanted.includes(name)) continue
    for (const theme of ['light', 'dark']) await record(browser, name, scene, theme)
  }
} finally {
  await browser.close()
}
