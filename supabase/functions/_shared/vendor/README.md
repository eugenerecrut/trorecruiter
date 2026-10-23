# PDFium renderer dependency

`pdfium-3.0.0.js` is the unmodified browser ESM build from `@hyzyla/pdfium@3.0.0`,
downloaded from the npm registry. Package license and PDFium notices are in
`PDFIUM-LICENSE.md` (copied from the package).

- Source: https://github.com/hyzyla/pdfium
- Package: https://registry.npmjs.org/@hyzyla/pdfium/-/pdfium-3.0.0.tgz
- Verified tarball integrity: `sha512-Hw7/Pc/y2f8ZYVNXxAvDiLAV0qJT4+e5HMwbMghra/s2RKXuuWYdR/8ohoD4YwQfTL5UzSNlTtP1LJHip7LiEQ==`
- JS SHA-256: `ed7d81def28de168132932d674ae5a836a5f53229cf3ea7d21b6861b94d32ff1`
- WASM SHA-256: `beeaf5bbff216d555fecec7cd486072838c4632a2272d31b52ef1fd05008fe7c`

The diagnostic loads only the version-pinned public WASM asset from jsDelivr,
checks its exact byte count and SHA-256 before execution, and sends no document
content, session headers or credentials to the asset host. The binary is not
embedded because it alone exceeds the Edge API bundle limit. CDN failure blocks
the diagnostic; it does not fall back to an unverified binary.

Only the owner diagnostic imports this module. The production document queue
does not yet render handwritten zones in Edge. Local Node measurements do not
establish Edge CPU/memory safety for arbitrary PDFs.
