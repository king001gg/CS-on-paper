// Publication guard: inspect Git's staged bytes, not ignored local files.
// Findings intentionally report only path/line/type; never print a secret value.
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, lstatSync } from 'node:fs'
import { resolve, relative, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const rules = [
  ['private key', /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,})\b/],
  ['service token', /\b(?:AKIA[A-Z0-9]{16}|sk-[A-Za-z0-9_-]{24,}|AIza[A-Za-z0-9_-]{30,}|xox[baprs]-[A-Za-z0-9-]{20,})\b/],
  ['credential in URL', /https?:\/\/[^\s/:]+:[^\s/@]+@/],
  ['authorization credential', /\b(?:Bearer|Basic)\s+[A-Za-z0-9+/_=-]{20,}/i],
  ['literal credential', /\b(?:api[_-]?key|client[_-]?secret|access[_-]?token|password|_authToken)\b["']?\s*[:=]\s*["'][A-Za-z0-9+/_=.:-]{16,}["']/i],
  ['personal filesystem path', /(?:[A-Z]:[\\/]+(?:Users|myCodes)[\\/]+[^\s"'<>]+|\/(?:home|Users)\/[^/\s"']+)/i],
  ['email address (manual review required)', /[A-Z0-9._%+-]+@(?!users\.noreply\.github\.com\b)[A-Z0-9.-]+\.[A-Z]{2,}/i]
]

export function inspectText(path, content, production = false) {
  const findings = []
  for (const [index, line] of content.split('\n').entries()) {
    for (const [type, pattern] of rules) {
      if (pattern.test(line)) findings.push({ path, line: index + 1, type })
    }
    if (production && /__PAPER_STRIKE__|sourceMappingURL=/.test(line)) {
      findings.push({ path, line: index + 1, type: 'development hook or source map in build' })
    }
  }
  return findings
}

const blockedPath = /(?:^|\/)(?:\.env(?:\..*)?|\.npmrc|\.netrc|\.pypirc|\.git-credentials|node_modules|dist|artifacts|coverage|test-results|playwright-report|\.ssh|\.aws|\.azure|\.config|\.idea|\.vscode)(?:\/|$)|\.(?:pem|key|p12|pfx|keystore|log|local)$/i
const allowedExtensions = new Set(['.js', '.mjs', '.json', '.css', '.html', '.md', '.svg', '.yml', '.yaml', '.txt'])
const allowedDotfiles = new Set(['.gitignore', '.gitattributes', '.node-version'])

function inspectFile(path, bytes, production, findings) {
  if (bytes.length > 2 * 1024 * 1024) {
    findings.push({ path, type: 'oversized file needs explicit review' })
    return
  }
  if (bytes.includes(0) || (!allowedExtensions.has(extname(path)) && !allowedDotfiles.has(path))) {
    findings.push({ path, type: 'unreviewed binary or file type' })
    return
  }
  findings.push(...inspectText(path, bytes.toString('utf8'), production))
}

function main() {
  const production = process.argv.includes('--dist')
  const findings = []
  let count = 0
  if (production) {
    const root = resolve('dist')
    function walk(dir) {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const file = resolve(dir, entry.name)
        const path = relative(root, file).replaceAll('\\', '/')
        if (lstatSync(file).isSymbolicLink()) {
          findings.push({ path, type: 'symlink in artifact' })
        } else if (entry.isDirectory()) {
          walk(file)
        } else {
          count++
          inspectFile(path, readFileSync(file), true, findings)
        }
      }
    }
    walk(root)
  } else {
    const entries = execFileSync('git', ['ls-files', '--stage', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
    for (const entry of entries) {
      const tab = entry.indexOf('\t')
      const [mode, , stage] = entry.slice(0, tab).split(' ')
      const path = entry.slice(tab + 1)
      count++
      if (!['100644', '100755'].includes(mode) || stage !== '0' || blockedPath.test(path)) {
        findings.push({ path, type: 'excluded, unresolved, or non-regular staged file' })
        continue
      }
      inspectFile(path, execFileSync('git', ['show', ':' + path], { maxBuffer: 8 * 1024 * 1024 }), false, findings)
    }
  }
  if (!count) throw new Error('No files inspected; stage the intended source or build dist first.')
  if (findings.length) {
    for (const f of findings) console.error(f.path + (f.line ? ':' + f.line : '') + ': ' + f.type)
    console.error('Publication check failed. Review findings before publishing; matching values are redacted.')
    process.exitCode = 1
  } else {
    console.log('Publication check passed: ' + count + (production ? ' production files' : ' staged source files') + '; no configured sensitive-data patterns found.')
    console.log('Pattern checks complement manual review; they are not an exhaustive security guarantee.')
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
