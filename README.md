# Hackaiz Import Gate — GitHub Action

Static security check of Skills, MCP configs, packages, workflows and Dockerfiles, powered by [Hackaiz](https://hackaiz.com).

## Usage

```yaml
name: Hackaiz Security Check
on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]

jobs:
  scan:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
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
        with:
          sarif_file: ${{ steps.hackaiz.outputs.sarif }}
```

## Setup
1. Create a personal API key in your Hackaiz account.
2. Add it as a repository secret named `HACKAIZ_API_KEY`.

## Behaviour
- **Danger** fails the job.
- No verdict (error, missing key or credits) also fails, unless `fail-on-incomplete: false`.
- Each run uses Hackaiz credits. Never expose the secret to fork pull requests.
- Static check only: it never executes, pushes or merges anything. A clean result is not a guarantee.
- SARIF upload to the Security tab needs code scanning enabled (GitHub Advanced Security on private repos).
