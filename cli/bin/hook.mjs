// Claude Code PreToolUse hook: `hackaiz hook claude`. Reads the hook JSON on stdin.
// Only Skill/MCP/package/workflow writes and install commands are checked (each check uses credits).
// Exit 2 blocks Danger, incomplete or unavailable checks. HACKAIZ_HOOK_FAIL_OPEN=1 explicitly opts into advisory mode.
import { randomUUID } from 'node:crypto';
const COMPONENT = /(^|\/)(SKILL\.md|mcp\.json|\.mcp\.json|claude_desktop_config\.json|package\.json|requirements\.txt|Dockerfile)$|\.github\/workflows\/[^/]+\.ya?ml$/i;
const INSTALL = /\b(claude\s+mcp\s+add|npx\s+-y|npm\s+(i|install|add)\b|pnpm\s+add|yarn\s+add|bun\s+add|pip3?\s+install|uvx|pipx\s+install)\b|\b(curl|wget)\b[^|]*\|\s*(ba|z)?sh\b/i;

export function hookTarget(event) {
  const tool = event?.tool_name; const input = event?.tool_input ?? {};
  if (['Write', 'Edit', 'MultiEdit'].includes(tool) && typeof input.file_path === 'string' && COMPONENT.test(input.file_path.replace(/\\/g, '/'))) {
    const content = tool === 'Write' ? input.content : tool === 'Edit' ? input.new_string : (input.edits ?? []).map((e) => e.new_string).join('\n');
    if (typeof content === 'string' && content) return { name: input.file_path.split(/[\\/]/).slice(-2).join('/'), files: [{ path: input.file_path.split(/[\\/]/).pop(), content }] };
  }
  if (tool === 'Bash' && typeof input.command === 'string' && INSTALL.test(input.command)) return { name: 'install-command', files: [{ path: 'install.sh', content: input.command }] };
  return null;
}

export async function hookCommand({ env, fetcher, stdin, errorOut }) {
  const fr = env.HACKAIZ_LANG === 'fr';
  const unavailable = (detail = '') => {
    errorOut(fr ? `Vérification Hackaiz indisponible${detail} ; action non vérifiée.` : `Hackaiz check unavailable${detail}; action not checked.`);
    return env.HACKAIZ_HOOK_FAIL_OPEN === '1' ? 0 : 2;
  };
  let event; try { event = JSON.parse(stdin); } catch { return unavailable(); }
  const target = hookTarget(event);
  if (!target) return 0;
  if (!/^hkz_[A-Za-z0-9_-]{40,}$/.test(env.HACKAIZ_API_KEY ?? '')) return unavailable();
  try {
    const origin = new URL(env.HACKAIZ_URL ?? 'https://hackaiz.com');
    if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) return unavailable();
    // Opting into this hook authorizes paid checks, not automatic installation on a missing verdict.
    const r = await fetcher(`${origin.origin}/api/public/v1/component-checks`, {
      method: 'POST', redirect: 'error', headers: { authorization: `Bearer ${env.HACKAIZ_API_KEY}`, 'content-type': 'application/json' },
      signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({ request_id: randomUUID(), channel: 'hook', name: target.name.slice(0, 120), language: env.HACKAIZ_LANG === 'fr' ? 'fr' : 'en', files: target.files }),
    });
    const data = await r.json();
    if (!r.ok) return unavailable(` (${r.status})`);
    if (data.verdict === 'danger') {
      errorOut(`${fr ? 'Hackaiz bloque cette action' : 'Hackaiz blocked this'}: ${data.headline}. ${data.summary} ${(data.findings ?? []).slice(0, 3).map((f) => `[${f.rule}] ${f.title} (${f.file}:${f.line})`).join(' ')}`);
      return 2;
    }
    if (data.complete !== true || !['safe', 'attention'].includes(data.verdict)) return unavailable();
    if (data.verdict === 'attention') errorOut(`${data.headline}. ${data.summary}`);
    return 0;
  } catch { return unavailable(); }
}
