/**
 * Which language some code is written in, from cues alone: a list of patterns for each language, each with a weight, and the language with
 * the most weight wins. No library, so it is quick, it never throws, and the desktop app (Detect.cs, generated from this table) says the same.
 * It answers undefined when nothing stands out (a word, a log line, prose), which is drawn as plain text.
 * Right for 94% of the code on a set of snippets written blind (test/detect-blind2.json) and for about nine in ten on the other sets in
 * test/detect-*.json; the usual slips are a single line of C#, Java, Python, C++ or Rust, which a reader fixes by picking the language.
 */
import { SNIPPET_MAX } from './snippets.ts'

/** One cue: a pattern (multi-line, as written) and what a match is worth. A pattern that matches again is worth one more, up to two more. */
export type Cue = readonly [pattern: RegExp, weight: number]

export const CUES: readonly { language: string; cues: readonly Cue[] }[] = [
  { language: 'dockerfile', cues: [
    [/^(RUN|COPY|ADD|ENTRYPOINT|CMD|EXPOSE|WORKDIR|ENV|ARG|USER|HEALTHCHECK|VOLUME|LABEL)\s/m, 4],
    [/^FROM\s+(--platform=\S+\s+)?[\w.\/-]+[:@]\S+/m, 4],
    [/^FROM\s+\S+\s+AS\s+\w+/mi, 4],
    [/^FROM\s+scratch\s*$/m, 4],
  ] },
  { language: 'bash', cues: [
    [/^#!.*\b(ba|z)?sh\b/m, 9],
    [/^\s*(echo|curl|export|sudo|apt|apt-get|cd|ls|grep|chmod|docker|kubectl|git|npm|cat|set -e)\b/m, 3],
    [/\$\{?\w+\}?/m, 1],
    [/^\s*(fi|done|esac)\s*$/m, 3],
    [/\[\[ .+ \]\]/m, 3],
    [/\|\s*(jq|grep|awk|sed|xargs)\b/m, 3],
    [/^\s*for \w+ in .*; do/m, 4],
  ] },
  { language: 'powershell', cues: [
    [/\b(Get|Set|New|Remove|Write|Invoke|Test|Restart|Expand|Join|Import|Start|Stop)-[A-Z]\w+/m, 4],
    [/\$\w+\s*=/m, 1],
    [/\bparam\s*\(/m, 3],
    [/\s-(eq|ne|not|and|or|gt|lt)\b/m, 3],
    [/\[CmdletBinding/m, 5],
    [/\$env:\w+/m, 4],
    [/\$_\b/m, 2],
  ] },
  { language: 'sql', cues: [
    [/\bSELECT\b[\s\S]*\bFROM\b/mi, 5],
    [/\b(INSERT INTO|CREATE TABLE|CREATE INDEX|GROUP BY|ORDER BY|LEFT JOIN|INNER JOIN|DELETE FROM)\b/mi, 3],
    [/\bWHERE\b/m, 3],
    [/^\s*UPDATE\s+\w+\s+SET\b/mi, 5],
    [/\b(VARCHAR|BIGINT|NUMERIC|TIMESTAMP)\b/m, 2],
  ] },
  { language: 'xml', cues: [
    [/^\s*<\?xml/m, 9],
  ] },
  { language: 'html', cues: [
    [/<!DOCTYPE html/mi, 9],
    [/<\/?(div|span|html|body|head|form|input|button|table|tr|td|th|h[1-6]|p|a|ul|li|script|link|meta|label|nav|main|header)\b[^>]*>/mi, 3],
    [/<\/\w+>/m, 2],
    [/<\w+(\s+[\w:-]+="[^"]*")*\s*\/?>/m, 2],
  ] },
  { language: 'css', cues: [
    [/^\s*[.#:@*\w][^{};\n()=]*\{\s*$/m, 2],
    [/^\s*[\w-]+\s*:\s*[^;{}]+;\s*$/m, 2],
    [/[.#][\w-]+(:[\w-]+)*\s*\{[^}]*:[^}]*\}/m, 5],
    [/@(media|import|keyframes|font-face)\b/m, 4],
    [/^\s*--[\w-]+\s*:/m, 3],
  ] },
  { language: 'markdown', cues: [
    [/^#{1,6}\s+\S/m, 3],
    [/\*\*[^*\n]+\*\*/m, 3],
    [/\[[^\]\n]+\]\([^)\n]+\)/m, 4],
    [/^```/m, 4],
    [/^>\s/m, 2],
    [/^\|.*\|\s*$/m, 3],
    [/^\s*(\d+\.|[-*])\s+\S/m, 1],
  ] },
  { language: 'php', cues: [
    [/<\?php/m, 9],
    [/\$this->/m, 4],
    [/\$\w+ = \w+::\w+\(/m, 3],
    [/\$\w+->\w+/m, 3],
    [/\$\w+::/m, 2],
    [/\w+::\w+\(/m, 2],
    [/^namespace [\w\\]+;/m, 4],
    [/\buse [\w\\]+;/m, 2],
    [/\bfunction \w+\(.*\)\s*(:\s*\w+)?\s*$/m, 1],
  ] },
  { language: 'ruby', cues: [
    [/^\s*(def|end|module|attr_\w+|before_action|puts|require)\b/m, 3],
    [/\|\w+(, ?\w+)*\|/m, 3],
    [/\bdo( \|.*\|)?\s*$/m, 3],
    [/@\w+\s*=/m, 2],
    [/&:\w+/m, 4],
    [/^\s*class \w+( < \w+)?\s*$/m, 3],
    [/\.(each|map|select|sum)\s*(\{|do)/m, 3],
  ] },
  { language: 'python', cues: [
    [/^\s*(async )?def \w+\(.*\)( -> [^:]+)?:\s*$/m, 5],
    [/^\s*(import \w+|from [\w.]+ import)/m, 3],
    [/\bself\b/m, 2],
    [/^\s*(if|for|while|with|try|else|elif|class)\b.*:\s*$/m, 2],
    [/\belif\b/m, 4],
    [/\bprint\(/m, 1],
    [/__name__|__init__/m, 4],
    [/\b(None|True|False)\b/m, 2],
    [/^\s*@\w+(\.\w+)*(\(.*\))?\s*$/m, 1],
    [/\blambda\b/m, 4],
    [/\bfor \w+(, ?\w+)* in [^\n]*[\]})]/m, 4],
    [/\braise \w+/m, 3],
  ] },
  { language: 'go', cues: [
    [/^package \w+\s*$/m, 4],
    [/\bfunc\b/m, 3],
    [/:=/m, 3],
    [/\berr != nil\b/m, 5],
    [/\b(fmt|http|context|errors)\.\w+/m, 2],
    [/\bdefer\b/m, 4],
    [/\bchan\b/m, 4],
  ] },
  { language: 'rust', cues: [
    [/\bfn \w+/m, 4],
    [/\blet mut\b/m, 5],
    [/\bimpl\b/m, 3],
    [/\bpub (async )?(fn|struct|enum)\b/m, 4],
    [/\w+!\(/m, 3],
    [/#\[derive/m, 6],
    [/\.unwrap\(\)|\?;/m, 3],
    [/&(mut )?self\b/m, 4],
    [/\buse [\w:]+::/m, 4],
    [/\.await\b/m, 2],
    [/\blet (mut )?\w+: (Vec|Option|Result|String|HashMap|Box|usize|[iuf](8|16|32|64))\b/m, 5],
    [/\.(iter|into_iter|collect)\(\)/m, 4],
  ] },
  { language: 'kotlin', cues: [
    [/\bfun \w+/m, 5],
    [/\bval \w+/m, 3],
    [/\bdata class\b/m, 6],
    [/\bsuspend\b/m, 5],
    [/\bwhen\b\s*(\(.*\))?\s*\{/m, 4],
    [/\?\.|\?:/m, 2],
    [/^import (io|kotlinx|androidx|org)\./m, 2],
    [/\bit\.\w+/m, 2],
  ] },
  { language: 'swift', cues: [
    [/\bfunc \w+/m, 3],
    [/\blet \w+/m, 1],
    [/\bguard\b/m, 5],
    [/^import (SwiftUI|Foundation|UIKit|Combine)/m, 9],
    [/\btry await\b/m, 4],
    [/@(State\w*|Published|MainActor|ObservedObject)/m, 5],
    [/\bsome View\b/m, 6],
    [/\bif let\b/m, 4],
    [/\bstruct \w+\s*:\s*\w+/m, 3],
    [/\bvar \w+\s*:\s*\w+/m, 1],
  ] },
  { language: 'java', cues: [
    [/\bpublic (static )?(final )?(class|interface|void|\w+<?\w*>?\s+\w+\()/m, 2],
    [/\bSystem\.out\b/m, 5],
    [/@(Override|Autowired|Service|RestController|GetMapping|Transactional|PathVariable|RequestMapping)/m, 5],
    [/^import java/m, 6],
    [/^package [\w.]+;/m, 3],
    [/\bprivate (static )?final\b/m, 3],
    [/\bpublic interface \w+/m, 4],
    [/\bLoggerFactory\.getLogger/m, 5],
    [/\b(extends|implements)\b/m, 2],
    [/\bnew \w+(<.*>)?\(/m, 1],
    [/\.stream\(\)/m, 3],
    [/\bString\b/m, 1],
  ] },
  { language: 'csharp', cues: [
    [/\.(ToListAsync|ToList|FirstOrDefaultAsync|FirstOrDefault|SingleOrDefaultAsync|SingleOrDefault|SaveChangesAsync|AnyAsync|Include)\(/m, 5],
    [/^using [\w.]+;/m, 3],
    [/^namespace [\w.]+;?/m, 3],
    [/\basync Task\b/m, 6],
    [/\bvar \w+ =/m, 2],
    [/\bpublic (sealed |abstract |async )?(record|class|interface)\b/m, 4],
    [/\[(Http\w+|ApiController|Route|FromBody)/m, 6],
    [/\bget;|\bset;/m, 4],
    [/\b(Guid|ILogger|CancellationToken|IActionResult|ActionResult)\b/m, 5],
    [/\bforeach \(/m, 3],
    [/\bnameof\(/m, 5],
    [/\bstring\b/m, 1],
    [/=> /m, 1],
  ] },
  { language: 'cpp', cues: [
    [/\bconst auto\b|\bauto&/m, 4],
    [/^#include\s*[<"]/m, 5],
    [/\bstd::/m, 5],
    [/\bnullptr\b/m, 4],
    [/\btemplate\s*</m, 5],
    [/\bcout\b|\bendl\b/m, 4],
    [/\bnamespace \w+\s*\{/m, 4],
    [/\bclass \w+\s*(:|\{)/m, 2],
    [/\bprintf\(|\bmalloc\(|\btypedef\b|\bint main\(/m, 3],
    [/\w->\w/m, 1],
    [/\b(errno|size_t|ssize_t|uint\d+_t|int\d+_t|NULL|sizeof)\b/m, 4],
    [/\bstruct \w+\s*\{/m, 2],
  ] },
  { language: 'typescript', cues: [
    [/[:,(]\s*(string|number|boolean|any|void|unknown)\b/m, 4],
    [/\binterface \w+/m, 5],
    [/\bfunction\s*\w*\s*\([^)]*\w\??: [A-Za-z]/m, 4],
    [/\(\w+\??: [A-Za-z]\w*(<[^>]*>)?(\[\])?\)\s*=>/m, 4],
    [/\)\s*: [A-Za-z][\w<>\[\]| ]*\s*(\{|=>)/m, 4],
    [/\btype \w+\s*=/m, 5],
    [/\bas (const|[A-Z]\w+)/m, 3],
    [/\breadonly\b/m, 4],
    [/\b(private|public|protected) (readonly )?\w+:/m, 4],
    [/\bPromise</m, 4],
    [/\bimport .* from ['"]/m, 2],
    [/\bexport (interface|type|class|function|const)\b/m, 2],
    [/\w<[A-Z]\w*(\[\])?>/m, 2],
  ] },
  { language: 'javascript', cues: [
    [/\b(const|let|var) \w+ =/m, 2],
    [/=>/m, 2],
    [/\brequire\(/m, 4],
    [/module\.exports/m, 5],
    [/\bfunction\s*\w*\s*\(/m, 3],
    [/\bconsole\.\w+/m, 4],
    [/\b(document|window)\.\w+/m, 4],
    [/\.then\(|\bawait\b/m, 2],
    [/\b(app|router)\.(get|post|put|use|listen)\(/m, 4],
    [/===|!==/m, 3],
  ] },
  { language: 'yaml', cues: [
    [/^[ \t]*[\w.-]+:([ \t]+\S.*)?$/m, 2],
    [/^\s*-\s+[\w.-]+:\s/m, 3],
    [/^(apiVersion|kind|metadata|spec|version|services|name|on|jobs):/m, 4],
    [/^---\s*$/m, 3],
  ] },
]

/** The least weight that is enough to name a language. */
export const MIN_SCORE = 3

/** A line that ends in a semicolon or an opening brace, or a lone closing brace: braces and semicolons are code, so they count against YAML. */
export const YAML_BUT_CODE = /;\s*$|\{\s*$|^\s*\}/m

/** What only C++ has. Code the cues call C++ that has none of these is C. */
export const CPP_ONLY = /std::|\bclass\b|namespace|template|cout|nullptr/


const count = (re: RegExp, text: string): number => {
  const all = new RegExp(re.source, `${re.flags}g`)
  let n = 0
  while (all.exec(text)) n++
  return n
}

/** Whether the code starts like a JSON document (ignoring spaces and line breaks) and is one. */
function isJson(text: string): boolean {
  if (!/^[ \t\r\n]*[{[]/.test(text)) return false
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

/** The id of the language the code is most likely written in, or undefined. Give it the code as `codeLines` joins it. */
export function guessLanguage(whole: string): string | undefined {
  // Only the first part is read: a snippet longer than the limit is a problem to fix, and a line of hundreds of thousands of characters must not stall the page.
  const text = whole.length > SNIPPET_MAX.chars ? whole.slice(0, SNIPPET_MAX.chars) : whole
  if (isJson(text)) return 'json'
  let best: string | undefined
  let bestScore = 0
  for (const { language, cues } of CUES) {
    let score = 0
    for (const [re, weight] of cues) {
      const n = count(re, text)
      if (n > 0) score += weight + Math.min(n - 1, 2)
    }
    if (language === 'yaml' && YAML_BUT_CODE.test(text)) score -= 3
    if (score > bestScore) {
      best = language
      bestScore = score
    }
  }
  if (best === 'cpp' && !CPP_ONLY.test(text)) best = 'c'
  return bestScore >= MIN_SCORE ? best : undefined
}
