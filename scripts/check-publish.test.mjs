import test from 'node:test'
import assert from 'node:assert/strict'
import { inspectText } from './check-publish.mjs'

// Construct fake fixtures at runtime; do not store credential-shaped values.
test('publication scanner flags credential families without echoing values', () => {
  const samples = [
    'ghp_' + 'a'.repeat(36),
    'github_pat_' + 'z'.repeat(60),
    'sk-' + 'b'.repeat(28),
    'AKIA' + 'X'.repeat(16),
    '-----BEGIN ' + 'PRIVATE KEY-----',
    'https://' + 'account:password' + '@example.invalid',
    'Bearer ' + 'a'.repeat(30),
    'api_key=' + '"' + 'c'.repeat(24) + '"',
    'C:/' + 'Users/' + 'example/file.txt',
    'person' + '@' + 'example.invalid'
  ]
  for (const sample of samples) {
    const findings = inspectText('fixture.txt', sample)
    assert.ok(findings.length > 0)
    assert.equal(findings[0].line, 1)
    assert.ok(!JSON.stringify(findings).includes(sample))
  }
})
test('production scanning rejects development hooks and source maps', () => {
  assert.equal(inspectText('bundle.js', '__PAPER_STRIKE__', true).length, 1)
  assert.equal(inspectText('bundle.js', '//# sourceMappingURL=bundle.map', true).length, 1)
  assert.equal(inspectText('src/main.js', '__PAPER_STRIKE__').length, 0)
})
test('public repository links, npm integrity hashes and Actions expressions are allowed', () => {
  const safe = ['https://moeyui1.github.io/CS-on-paper/', 'https://registry.npmjs.org/three', 'sha512-' + 'A'.repeat(88), 'process.env.PS_BROWSER', '$' + '{{ github.token }}'].join('\n')
  assert.deepEqual(inspectText('fixture.txt', safe), [])
})
