# Hackaiz Import Gate — GitHub Action

[![GitHub Marketplace](https://img.shields.io/badge/Marketplace-Hackaiz%20Import%20Gate-blue?logo=github)](https://github.com/marketplace/actions/hackaiz-import-gate)

Security check (rules + expert AI review) of Skills, MCP configurations, packages, workflows and Dockerfiles in your repository.

```yaml
name: Hackaiz Security Check
on:
  push: { branches: [main] }
  pull_request: { branches: [main] }
jobs:
  scan:
    runs-on: ubuntu-latest
    permissions: { contents: read, security-events: write }
    steps:
      - uses: actions/checkout@v4
        with: { persist-credentials: false }
      - id: hackaiz
        uses: Hacktualiz/import-gate@v1
        with:
          api-key: ${{ secrets.HACKAIZ_API_KEY }}
          path: .
      - if: always()
        uses: github/codeql-action/upload-sarif@v3
        with: { sarif_file: ${{ steps.hackaiz.outputs.sarif }} }
```

1. Create a key on hackaiz.com, then add it as the repository secret `HACKAIZ_API_KEY`.
2. Add the file above as `.github/workflows/hackaiz.yml` (GitHub's "Choose a workflow" page does not list Marketplace actions).

- Danger fails the job. No verdict (error, no credits, incomplete) fails too unless `fail-on-incomplete: false`.
- Each run uses credits. Never give the secret to fork pull requests.
- SARIF upload to the Security tab needs `security-events: write` in the job permissions. On private repositories it also requires GitHub Code Security (Advanced Security); otherwise GitHub answers `Resource not accessible by integration`. The findings stay visible in the job summary and as annotations either way.
- Quality notes on Skills (vague description, missing warnings…) appear as notices and never fail the job.
- Never executes, pushes or merges anything.

Docs: https://hackaiz.com/docs/github-action
