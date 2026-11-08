// `hackaiz check <path> [--sarif]`: static check of a Skill / MCP / package / workflow before installing.
// Exit 2 on a Danger verdict so CI can block. Secret, binary and generated files are never sent.
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, basename } from 'node:path';
import { randomUUID } from 'node:crypto';

const SKIP_DIR = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.venv', 'venv', '__pycache__']);
const SECRET = /(^|\/)(\.env(\..*)?|.*\.(pem|key|p12|pfx|keystore|jks)|id_rsa|id_ed25519|\.npmrc|\.netrc)$/i;
const BINARY = /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|exe|dll|so|dylib|wasm|woff2?|ttf|mp[34]|lockb|bin)$/i;

export async function collectComponent(root, { maxFiles = 400, maxFileBytes = 400 * 1024 } = {}) {
  const files = []; const skipped = [];
  const s = await stat(root);
  const walk = async (dir) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (files.length >= maxFiles) return;
      const full = join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIR.has(e.name)) await walk(full); continue; }
      const rel = relative(root, full).replace(/\\/g, '/');
      const size = (await stat(full)).size;
      if (SECRET.test(rel) || BINARY.test(rel) || size > maxFileBytes) { skipped.push(rel); continue; }
      const content = await readFile(full, 'utf8');
      if (content.includes('\u0000')) { skipped.push(rel); continue; }
      files.push({ path: rel, content });
    }
  };
  if (s.isDirectory()) await walk(root);
  else if (!SECRET.test(root)) files.push({ path: basename(root), content: await readFile(root, 'utf8') });
  return { files, skipped };
}

export function toSarif(result) {
  const level = (s) => (s === 'Critical' || s === 'High' ? 'error' : s === 'Medium' ? 'warning' : 'note');
  return {
    version: '2.1.0', $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    runs: [{
      tool: { driver: { name: 'Hackaiz Import Gate', informationUri: 'https://hackaiz.com/check', rules: [...new Map((result.findings ?? []).map((f) => [f.rule, { id: f.rule, shortDescription: { text: f.title }, help: { text: f.action }, properties: { cwe: f.cwe, owasp: f.owasp } }])).values()] } },
      results: (result.findings ?? []).map((f) => ({ ruleId: f.rule, level: level(f.severity), message: { text: `${f.title}: ${f.impact}` }, locations: [{ physicalLocation: { artifactLocation: { uri: f.file }, region: { startLine: f.line } } }] })),
    }],
  };
}

export async function checkCommand(target, flags, { env, fetcher, output }) {
  if (!target) throw Error('Usage: hackaiz check <path> [--sarif] [--lang fr]');
  const origin = new URL(env.HACKAIZ_URL ?? 'https://hackaiz.com');
  if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.username) throw Error('HACKAIZ_URL must be an HTTPS origin');
  if (!/^hkz_[A-Za-z0-9_-]{40,}$/.test(env.HACKAIZ_API_KEY ?? '')) throw Error('HACKAIZ_API_KEY is required');
  const { files } = await collectComponent(target);
  if (!files.length) throw Error('Nothing to check (secret, binary and large files are never sent)');
  const lang = flags.includes('--lang') && flags[flags.indexOf('--lang') + 1] === 'fr' ? 'fr' : 'en';
  const response = await fetcher(`${origin.origin}/api/public/v1/component-checks`, {
    method: 'POST', redirect: 'error', headers: { authorization: `Bearer ${env.HACKAIZ_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ request_id: randomUUID(), channel: env.GITHUB_ACTIONS === 'true' ? 'ci' : 'cli', name: basename(target).slice(0, 120) || 'component', language: lang, files }),
  });
  const data = await response.json();
  if (!response.ok) throw Error(`Hackaiz ${response.status}: ${data.error ?? 'request_failed'}`);
  output(JSON.stringify(flags.includes('--sarif') ? toSarif(data) : data, null, 2));
  return data.verdict === 'danger' ? 2 : 0;
}
