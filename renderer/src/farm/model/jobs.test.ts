import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TOOL_CLASSES } from '../../../../shared/protocol.ts';
import { clsJob, rawJob, stickyTool } from './jobs.ts';
import { JOBS } from './types.ts';

test('clsJob maps every tool class to a known job, and rawJob agrees for working agents', () => {
  for (const cls of TOOL_CLASSES) {
    const j = clsJob(cls);
    assert.ok((JOBS as readonly string[]).includes(j), `${cls} → ${j}`);
    assert.equal(rawJob({ status: 'working', activity: { tool: null, cls, detail: '', since: 0 }, prompt: null, subagents: [] }), j);
  }
  assert.equal(clsJob(null), 'plan');
  assert.equal(clsJob('search'), 'inspect');
  assert.equal(clsJob('web'), 'fetch');
  assert.equal(clsJob('compact'), 'rest');
});

test('stickyTool keeps the latest class of the visible job and ignores churn from other families', () => {
  // a grep inside the inspect job shows as search
  assert.equal(stickyTool('inspect', 'search', null), 'search');
  assert.equal(stickyTool('inspect', 'read', 'search'), 'read');
  // an edit flickering through while the visible job is still inspect keeps the flavour
  assert.equal(stickyTool('inspect', 'edit', 'read'), 'read');
  // between tools (activity cleared) the flavour stays
  assert.equal(stickyTool('inspect', null, 'read'), 'read');
  assert.equal(stickyTool('inspect', undefined, 'search'), 'search');
  // a new visible job with nothing matching yet clears it; with a match takes it
  assert.equal(stickyTool('plant', 'read', 'read'), null);
  assert.equal(stickyTool('fetch', 'mcp', 'read'), 'mcp');
  assert.equal(stickyTool('plan', 'think', null), 'think');
  assert.equal(stickyTool('ask', 'edit', 'edit'), null);
});
