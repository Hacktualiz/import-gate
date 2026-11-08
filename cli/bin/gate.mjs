/** A gate refers to one saved-platform run, never to an inferred PR commit. */
export function savedRunGate(analysis, findings) {
  if (analysis?.status !== 'success') return { verdict: 'inconclusive', reason: 'analysis_not_complete', exitCode: 2 };
  const dangerous = findings.filter(f => ['critical', 'high'].includes(String(f.severity).toLowerCase()) && f.status !== 'resolved');
  return dangerous.length ? { verdict: 'fail', unresolvedHighOrCritical: dangerous.length, exitCode: 1 } : { verdict: 'pass', unresolvedHighOrCritical: 0, exitCode: 0 };
}