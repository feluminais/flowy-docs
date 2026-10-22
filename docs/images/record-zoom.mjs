/**
 * Records zoom-light.gif and zoom-dark.gif, the pictures at the top of the README: the browser canvas on the Plum demo,
 * driven by a script in headless Chrome (no window opens), then cut into GIFs by ffmpeg.
 *
 *     npm run build
 *     npm install --no-save puppeteer-core
 *     node docs/images/record-zoom.mjs
 *
 * Needs ffmpeg on the PATH and Chrome or Edge. Set CHROME to the browser's path if it isn't found. Retake it when the canvas changes how
 * it looks or moves. The story is in `story` below: zoom in twice, zoom out, play a flow, zoom sideways, step up a load test, and
 * zoom out to where it started so the loop is seamless.
 */
import puppeteer from 'puppeteer-core'
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..')
const WIDTH = 1280
const HEIGHT = 800
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
    #reel-cap{position:fixed;left:50%;top:4px;z-index:99999;pointer-events:none;transform:translate(-50%,-6px);opacity:0;transition:opacity .25s,transform .25s;
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

async function record(browser, theme, frames, url) {
  const page = await browser.newPage()
  await page.setViewport({ width: WIDTH, height: HEIGHT, deviceScaleFactor: 1 })
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: theme }])
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('.react-flow__node')
  await page.evaluate(overlay)
  const pos = { x: WIDTH * 0.7, y: HEIGHT * 0.5 }
  await page.mouse.move(pos.x, pos.y)

  const glide = async (x, y, ms = 600) => {
    const steps = Math.max(2, Math.round(ms / 16))
    const { x: x0, y: y0 } = pos
    for (let i = 1; i <= steps; i++) {
      const t = ease(i / steps)
      await page.mouse.move(x0 + (x - x0) * t, y0 + (y - y0) * t)
      await sleep(16)
    }
    pos.x = x
    pos.y = y
  }
  const centre = async sel => page.$eval(sel, el => { const b = el.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2] })
  const node = id => `.react-flow__node[data-id="${id}"]`
  const park = (ms = 450) => glide(1190, 735, ms) // an empty corner, so no shape shows its tooltip
  const aim = async (sel, ms) => { const [x, y] = await centre(sel); await glide(x, y, ms) }
  const click = async (sel, ms = 600) => { await aim(sel, ms); await sleep(120); await page.mouse.down({ clickCount: 1 }); await sleep(60); await page.mouse.up({ clickCount: 1 }) }
  const dblclick = async (sel, ms = 600) => {
    await aim(sel, ms); await sleep(120)
    await page.mouse.down({ clickCount: 1 }); await sleep(40); await page.mouse.up({ clickCount: 1 }); await sleep(90)
    await page.mouse.down({ clickCount: 2 }); await sleep(40); await page.mouse.up({ clickCount: 2 })
  }
  const caption = text => page.evaluate(t => {
    const c = document.getElementById('reel-cap')
    if (t) { c.textContent = t; c.classList.add('on') } else c.classList.remove('on')
  }, text)
  const key = k => page.keyboard.press(k)

  const dir = join(frames, theme)
  mkdirSync(dir, { recursive: true })
  const cdp = await page.createCDPSession()
  const shots = []
  cdp.on('Page.screencastFrame', f => {
    const name = `f${String(shots.length).padStart(5, '0')}.png`
    writeFileSync(join(dir, name), Buffer.from(f.data, 'base64'))
    shots.push({ name, ts: f.metadata.timestamp })
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
  })
  await sleep(800)
  await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 })

  // The story. Esc steps up a level, so the last two take the view back to the overview, and the loop starts where it ended.
  await glide(560, 420, 450); await sleep(250)
  await caption('Zoom in')
  await dblclick(node('ordering'), 500); await park(); await sleep(700)
  await dblclick(node('order-api'), 500); await park(); await sleep(900)
  await caption('Zoom out')
  await key('Escape'); await sleep(900)

  await caption('Play a flow')
  await key('l'); await sleep(500)
  await click('::-p-text(Customer places an order)', 600); await park(); await sleep(250)
  await key('l'); await sleep(900)
  for (let step = 0; step < 6; step++) { await key('ArrowRight'); await sleep(step === 5 ? 1400 : 1000) }
  await key('Escape'); await sleep(700)

  await caption('Zoom sideways')
  await dblclick(node('delivery'), 600); await park(); await sleep(1200)

  await caption('Replay a load test')
  await key('t'); await sleep(700)
  await key('Home'); await sleep(1100)
  for (let level = 0; level < 4; level++) { await key('ArrowRight'); await sleep(level === 2 ? 1700 : 1200) }
  await caption(null)
  await key('Escape'); await sleep(500)
  await key('Escape'); await sleep(2400)
  await cdp.send('Page.stopScreencast')
  await page.close()
  const list = shots.map((s, i) => `file '${s.name}'\nduration ${(i + 1 < shots.length ? shots[i + 1].ts - s.ts : 0.15).toFixed(4)}`)
  list.push(`file '${shots.at(-1).name}'`)
  writeFileSync(join(dir, 'list.txt'), list.join('\n'))
  return dir
}

function toGif(dir, out) {
  const mp4 = join(dir, 'reel.mp4')
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', join(dir, 'list.txt'), '-vf', 'fps=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', mp4])
  const filter = 'fps=15,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle'
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', mp4, '-vf', filter, out])
}

const state = mkdtempSync(join(tmpdir(), 'flowy-reel-state-'))
const frames = mkdtempSync(join(tmpdir(), 'flowy-reel-frames-'))
const server = spawn(process.execPath, ['dist/cli.js', '--dir', 'docs/demo/flowy', '--no-open'], {
  cwd: root, env: { ...process.env, FLOWY_STATE_DIR: state }, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true,
})
try {
  // The server says where it is listening, on the first port that was free.
  const url = await new Promise((resolve, reject) => {
    server.on('exit', () => reject(new Error('The demo server stopped: run npm run build first')))
    server.stdout.on('data', chunk => { const m = /http:\/\/127\.0\.0\.1:\d+\//.exec(String(chunk)); if (m) resolve(m[0]) })
    setTimeout(() => reject(new Error('The demo server did not start')), 15000)
  })
  const browser = await puppeteer.launch({ executablePath: findBrowser(), headless: true, args: ['--hide-scrollbars', '--force-color-profile=srgb'] })
  try {
    for (const theme of ['light', 'dark']) {
      const dir = await record(browser, theme, frames, url)
      toGif(dir, join(here, `zoom-${theme}.gif`))
      console.log(`zoom-${theme}.gif`)
    }
  } finally {
    await browser.close()
  }
} finally {
  server.kill()
  rmSync(state, { recursive: true, force: true })
  rmSync(frames, { recursive: true, force: true })
}
