const test = require('node:test');
const assert = require('node:assert/strict');

const choices = require('../spatial-program-choice-model.js');

const source = [
  'selected = choice({',
  '  "id": "status",',
  '  "options": [',
  '    {"id": "todo", "label": "待办"},',
  '    {"id": "done", "label": "完成"}',
  '  ],',
  '  "selected": ["todo"],',
  '  "empty": "未选择"',
  '})',
  'message("ok")'
].join('\n');

test('parses canonical JSON choice calls without executing Program source', () => {
  assert.deepEqual(choices.parse(source), [{
    id: 'status',
    options: [
      { id: 'todo', label: '待办' },
      { id: 'done', label: '完成' }
    ],
    selected: ['todo'],
    empty: '未选择'
  }]);
});

test('toggles one option and rewrites only the registered choice argument', () => {
  const updated = choices.toggle(source, 'status', 'done');
  assert.equal(updated.selected.includes('done'), true);
  assert.equal(updated.source.endsWith('message("ok")'), true);
  assert.deepEqual(choices.parse(updated.source)[0].selected, ['todo', 'done']);

  const reverted = choices.toggle(updated.source, 'status', 'todo');
  assert.deepEqual(choices.parse(reverted.source)[0].selected, ['done']);
});

test('rejects non-canonical or ambiguous choice source instead of guessing', () => {
  assert.deepEqual(choices.parse("choice({'id': 'legacy'})"), []);
  assert.throws(() => choices.toggle(source, 'missing', 'todo'), /CHOICE_NOT_FOUND/);
  assert.throws(() => choices.toggle(source, 'status', 'missing'), /CHOICE_OPTION_NOT_FOUND/);
});
