// Writes desktop/THIRD-PARTY-NOTICES.md: every package the app ships, with its licence and copyright line, read from the NuGet cache.
// Run from the repo root after `dotnet restore desktop`:  node desktop/tools/third-party.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const assets = JSON.parse(readFileSync('desktop/Flowy.App/obj/project.assets.json', 'utf8'))
const cache = process.env.NUGET_PACKAGES ?? join(homedir(), '.nuget', 'packages')
const tag = (xml, name) => xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`))?.[1]?.trim().replace(/\s+/g, ' ')

// What ships: the packages the app's runtime references. Build-only packages (analyzers, generators, the SDK's own) are left out.
const runtime = new Set()
for (const [target, libs] of Object.entries(assets.targets)) {
  if (!target.startsWith('net10.0')) continue
  for (const [id, lib] of Object.entries(libs)) if (lib.type === 'package' && (lib.runtime || lib.native || lib.runtimeTargets || lib.compile)) runtime.add(id)
}

const rows = []
for (const id of [...runtime].sort((a, b) => a.localeCompare(b))) {
  const [name, version] = id.split('/')
  const nuspec = join(cache, name.toLowerCase(), version, `${name.toLowerCase()}.nuspec`)
  const xml = existsSync(nuspec) ? readFileSync(nuspec, 'utf8') : ''
  const license = tag(xml, 'license')
  rows.push({
    name,
    version,
    // A package that names a file, not a licence: the one such here is ANGLE, which is BSD-3-Clause.
    license: !license ? 'see package' : license === 'LICENSE' ? 'its LICENSE file (ANGLE: BSD-3-Clause)' : license,
    url: (tag(xml, 'projectUrl') ?? '').replace(/&amp;/g, '&'),
    copyright: tag(xml, 'copyright') ?? '',
  })
}

const MIT = `Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.`
const BSD = `Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following conditions are met: redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer; redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following disclaimer in the documentation and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.`

const licenses = new Set(rows.map(r => r.license))
const text = [
  '# Third-party notices',
  '',
  'Flowy Docs (the desktop app) is MIT licensed. It is built from the packages below, each under its own licence, and ships the box icons',
  'of [Tabler Icons](https://tabler.io/icons) (MIT, see `TABLER-ICONS-LICENSE.txt`) and the .NET runtime (MIT, © .NET Foundation and contributors).',
  'This file is written by `node desktop/tools/third-party.mjs` from the packages the app was restored with.',
  '',
  '| Package | Version | Licence | Copyright |',
  '| --- | --- | --- | --- |',
  ...rows.map(r => `| [${r.name}](${r.url || 'https://www.nuget.org/packages/' + r.name}) | ${r.version} | ${r.license} | ${r.copyright.replace(/\|/g, '/')} |`),
  '',
  '## Licence texts',
  '',
  ...(licenses.has('MIT') || [...licenses].some(l => l.includes('MIT')) ? ['### MIT', '', MIT, ''] : []),
  ...([...licenses].some(l => l.includes('BSD')) ? ['### BSD-style (2- and 3-clause)', '', BSD, ''] : []),
  ...([...licenses].filter(l => !/MIT|BSD/.test(l)).map(l => `### ${l}\n\nSee the package's own licence file, linked from its NuGet page.\n`)),
].join('\n')
writeFileSync('desktop/THIRD-PARTY-NOTICES.md', text)
console.log(`wrote desktop/THIRD-PARTY-NOTICES.md: ${rows.length} packages, licences ${[...licenses].join(', ')}`)
