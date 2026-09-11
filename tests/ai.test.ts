import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTask } from '../lib/stride/ai';
import { taskData } from '../lib/stride/types';
void test('AI sends only opted-in task/project context and validates before returning an editable preview', async () => {
  const originalFetch = globalThis.fetch;
  let body = '';
  let result: unknown = taskData('Parsed', {
    project: 'project-a',
    section: 'Drafts',
    dependencies: ['task-a', 'unknown'],
  });
  globalThis.fetch = async (_request, init) => {
    body = typeof init?.body === 'string' ? init.body : '';
    assert.equal(
      new Headers(init?.headers).get('x-goog-api-key'),
      'test-device-key',
    );
    return Response.json({
      candidates: [{ content: { parts: [{ text: JSON.stringify(result) }] } }],
    });
  };
  try {
    const parsed = await parseTask(
      'Prepare a draft',
      'test-device-key',
      'selected-model',
      [
        {
          id: 'project-a',
          kind: 'project',
          data: { title: 'Selected project', sections: ['Drafts'] },
        },
        { id: 'task-a', kind: 'task', data: taskData('Selected task') },
        { id: 'page-a', kind: 'page', data: { title: 'PRIVATE PAGE CONTENT' } },
      ],
      'America/Toronto',
    );
    assert.equal(parsed.section, 'Drafts');
    assert.deepEqual(parsed.dependencies, ['task-a']);
    assert.equal(body.includes('PRIVATE PAGE CONTENT'), false);
    assert.equal(body.includes('test-device-key'), false);
    assert.equal(body.includes('Selected project'), true);
    result = { title: 'Malformed', dependencies: {} };
    await assert.rejects(
      parseTask('Text', 'test-device-key', 'selected-model', [], 'UTC'),
      /dependencies/,
    );
    result = null;
    await assert.rejects(
      parseTask('Text', 'test-device-key', 'selected-model', [], 'UTC'),
      /invalid task/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
