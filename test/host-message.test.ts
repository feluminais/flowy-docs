import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyMessage, textToCopy } from '../src/core/host.ts'

test('a page asks its host to copy text, and the host reads it back', () => {
  assert.equal(textToCopy(copyMessage('```mermaid\ngraph TD\n```\n')), '```mermaid\ngraph TD\n```\n')
  assert.equal(textToCopy(copyMessage('')), '')
})

test('any other message asks for nothing', () => {
  for (const data of [undefined, null, 'flowy-copy', 3, [], {}, { type: 'other', text: 'x' }, { type: 'flowy-copy' }, { type: 'flowy-copy', text: 5 }])
    assert.equal(textToCopy(data), undefined, JSON.stringify(data))
})
