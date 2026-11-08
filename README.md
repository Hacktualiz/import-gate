# Hackaiz Import Gate — GitHub Action (prepared, not yet on the Marketplace)

```yaml
permissions: { contents: read, security-events: write }
steps:
  - uses: actions/checkout@v4
    with: { persist-credentials: false }
  - id: hackaiz
    uses: hackaiz/import-gate@v1
    with:
      api-key: ${{ secrets.HACKAIZ_API_KEY }}
      path: .
  - if: always()
    uses: github/codeql-action/upload-sarif@v3
    with: { sarif_file: ${{ steps.hackaiz.outputs.sarif }} }
```

- Danger fails the job. No verdict (error, no credits) fails too unless `fail-on-incomplete: false`.
- Each run uses credits. Never give the secret to fork pull requests.
- Static check only; never executes, pushes or merges anything.

## Publishing (owner action)

Run `sh tools/hackaiz-action/package.sh`, push `/tmp/hackaiz-import-gate` to a public repo `hackaiz/import-gate`, tag `v1`, then tick "Publish to Marketplace" on the release.
