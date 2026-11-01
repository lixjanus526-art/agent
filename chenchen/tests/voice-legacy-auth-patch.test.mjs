import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
// Regression evidence for an explicitly unapplied patch, not a claim of production remediation.
for (const path of ['../../cloudflare/worker.js', '../deployment/worker.js']) {
  test(`legacy missing-key exposure reproduced and isolated patch verified: ${path}`, async () => {
    const source = await readFile(new URL(path, import.meta.url), 'utf8');
    const fn = source.match(/function requiresApiKey\(request, env\) \{[\s\S]*?\n\}/)?.[0];
    assert.ok(fn);
    const evaluate = code => vm.runInNewContext('(' + code + ')');
    const request = new Request('https://test.invalid');
    assert.equal(evaluate(fn)(request, { MODEL_PROVIDER: 'workers_ai' }), true, 'Known legacy exposure must remain explicit until Owner applies patch');
    const corrected = fn.replace(/  if \(\["bailian"[\s\S]*?return false;\n/, '').replace('return !expected ||', 'return Boolean(expected) &&');
    const verify = evaluate(corrected);
    for (const provider of ['workers_ai', 'aliyun_bailian']) {
      assert.equal(verify(request, { MODEL_PROVIDER: provider }), false);
      assert.equal(verify(request, { MODEL_PROVIDER: provider, CORE_AGENT_API_KEY: 'synthetic' }), false);
      assert.equal(verify(new Request(request, { headers: { 'X-Core-Agent-Key': 'synthetic' } }), { MODEL_PROVIDER: provider, CORE_AGENT_API_KEY: 'synthetic' }), true);
    }
  });
}
