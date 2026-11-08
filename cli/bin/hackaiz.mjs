#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { savedRunGate } from './gate.mjs';

export async function run(args, { env = process.env, fetcher = fetch, output = console.log, stdin, errorOut, wait = (ms) => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const [command, projectId, value] = args;
  if (command === 'help' || !command) {
    output('hackaiz analyze <project-id> [request-key]\nhackaiz status <project-id> <run-id>\nhackaiz verify <project-id> <run-id>\nhackaiz report <project-id>\nhackaiz findings <project-id>\nhackaiz check <path> [--sarif] [--lang fr]  (Skill/MCP/package/workflow before installing; exit 2 on Danger)\nhackaiz hook claude  (Claude Code PreToolUse hook: blocks Danger Skills/MCP/installs)\nHACKAIZ_API_KEY: personal key. HACKAIZ_URL: optional HTTPS origin.');
    return 0;
  }
  if (command === 'hook') {
    const { hookCommand } = await import('./hook.mjs');
    const chunks = []; for await (const c of (stdin ?? process.stdin)) chunks.push(c);
    return hookCommand({ env, fetcher, stdin: Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8'), errorOut: errorOut ?? console.error });
  }
  if (command === 'check') {
    const { checkCommand } = await import('./check.mjs');
    return checkCommand(projectId, args.slice(2), { env, fetcher, output });
  }
  if (!['analyze', 'status', 'verify', 'report', 'findings'].includes(command)) throw Error('Unsupported command');
  if (!/^[0-9a-f-]{36}$/i.test(projectId ?? '')) throw Error('A platform UUID is required');
  const origin = new URL(env.HACKAIZ_URL ?? 'https://hackaiz.com');
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw Error('HACKAIZ_URL must be an HTTPS origin');
  if (!/^hkz_[A-Za-z0-9_-]{40,}$/.test(env.HACKAIZ_API_KEY ?? '')) throw Error('HACKAIZ_API_KEY is required');
  const base = `${origin.origin}/api/public/v1/projects/${projectId}`;
  const call = async (path, body) => {
    const response = await fetcher(`${base}/${path}`, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${env.HACKAIZ_API_KEY}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error' });
    const data = await response.json();
    if (!response.ok) throw Error(`Hackaiz ${response.status}: ${data.error ?? 'request_failed'}${data.purchaseUrl ? ` — ${data.purchaseUrl}` : ''}`);
    return data;
  };
  if (command === 'analyze') {
    const requestKey = value ?? randomUUID();
    const accepted = await call('analysis-requests', { request_key: requestKey, channel: env.GITHUB_ACTIONS === 'true' ? 'ci' : 'cli' });
    if (!/^[0-9a-f-]{36}$/i.test(accepted.requestId ?? '')) throw Error('Invalid analysis response');
    output(JSON.stringify({ requestId: accepted.requestId, requestKey, status: accepted.status }));
    if (accepted.delivery === 'configuration_required') throw Error('Autonomous processing is not configured; keep this request ID');
    // GET-only polling. Closing the client does not cancel autonomous work.
    // A lost response never creates another run or invokes execution again.
    for (let attempt = 0; attempt < 360; attempt++) {
      const result = await call(`analysis-runs/${accepted.requestId}`);
      const status = result.request?.status;
      if (['success', 'partial', 'failed', 'cancelled'].includes(status)) {
        output(JSON.stringify(result));
        return ['success', 'partial'].includes(status) ? 0 : 2;
      }
      await wait(5000);
    }
    output(JSON.stringify({ requestId: accepted.requestId, status: 'still_pending', note: 'Use status with the same request ID; do not create a replacement.' }));
    return 2;
  }
  if (command === 'status') {
    if (!/^[0-9a-f-]{36}$/i.test(value ?? '')) throw Error('A run UUID is required');
    output(JSON.stringify(await call(`analysis-runs/${value}`))); return 0;
  }
  if (command === 'verify') {
    if (!/^[0-9a-f-]{36}$/i.test(value ?? '')) throw Error('A run UUID is required');
    const status = await call(`analysis-runs/${value}`);
    const scan = status.analysis;
    if (!scan || !/^[0-9a-f-]{36}$/i.test(scan.id ?? '') || status.request?.scan_id !== scan.id || scan.status !== 'success') {
      output(JSON.stringify({ verdict: 'inconclusive', reason: 'analysis_not_complete_or_unlinked', runId: value }));
      return 2;
    }
    const findings = []; const seen = new Set(); let offset = 0; let total;
    for (;;) {
      const result = await call(`findings?scanId=${scan.id}&status=open&limit=100&offset=${offset}`);
      const invalid = !Array.isArray(result.data) || !Number.isSafeInteger(result.total) || result.total < 0 || result.total > 100000 || (total !== undefined && result.total !== total)
        || result.data.length > 100 || offset + result.data.length > result.total || (!result.data.length && offset < result.total)
        || result.data.some(f => !f || f.scan_id !== scan.id || typeof f.id !== 'string' || !f.id || seen.has(f.id) || !['critical', 'high', 'medium', 'low', 'info'].includes(String(f.severity).toLowerCase()) || f.status !== 'open');
      if (invalid || (Array.isArray(result.data) && new Set(result.data.map(f => f.id)).size !== result.data.length)) {
        output(JSON.stringify({ verdict: 'inconclusive', reason: 'invalid_findings_pagination', runId: value, scanId: scan.id }));
        return 2;
      }
      total = result.total;
      result.data.forEach(f => seen.add(f.id));
      findings.push(...result.data); offset += result.data.length;
      if (offset === total) break;
    }
    const verdict = savedRunGate(scan, findings);
    output(JSON.stringify({ ...verdict, runId: value, scanId: scan.id, scope: 'saved_platform_not_pr_commit' }));
    return verdict.exitCode;
  }
  let offset = 0;
  do {
    const result = await call(`${command === 'report' ? 'scans' : 'findings'}?limit=100&offset=${offset}`);
    output(JSON.stringify(result));
    offset += result.data?.length ?? 0;
    if (!result.data?.length || offset >= result.total) break;
  } while (true);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error) => { console.error(error.message); process.exitCode = 1; });
}