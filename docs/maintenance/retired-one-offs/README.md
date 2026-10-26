# Retired one-off patches

These original workflow sources were moved out of `.github/workflows` on 2026-10-26 after the UI and document pipeline had changed. They remain historical references in Git and are not GitHub Actions workflows from this location.

- `fix-documents-button.yml`: repeatedly failed on `Target Documents button not found` after the document UI changed.
- `add-delete-case-buttons.yml`: repeatedly failed on `table header pattern not found` after the case list changed.
- `fix-document-route-once.yml`: historical one-time string replacement for the document route, including a write/push step against an old source shape.

Current behavior is covered by the existing document navigation, upload pipeline, case and archive regressions. Normal regression, Pages deployment and scanner build workflows remain active. Future code changes should use an ordinary reviewed change with tests rather than rerunning these historical string replacements.

`tests/crm-retired-workflows.cjs` checks that the three patches stay outside the runnable workflow directory and that their archived contents are preserved (SHA-256 after CRLF/LF normalization). Restore a historical workflow only as a deliberate reviewed change with its own current acceptance criteria.
