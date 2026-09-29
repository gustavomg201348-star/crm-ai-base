# Vendored SheetJS CE

This directory contains the official SheetJS Community Edition package used by
QEVORA.

- Package: `xlsx`
- Version: `0.20.3`
- License: Apache-2.0
- Official source: https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
- SHA-256: `8DC73FC3B00203E72D176E85B50938627C7B086E607C682E8D3C22C02BB99FE8`
- Vendored on: 2026-09-29

## Why this package is vendored

The public npm registry only serves the obsolete `xlsx@0.18.5` release. SheetJS
publishes supported Community Edition releases from its official CDN. Keeping
the exact upstream tarball in the repository makes `npm ci` and Docker builds
reproducible without resolving a mutable remote URL during installation.

## Update procedure

1. Select a published SheetJS CE release from the official SheetJS CDN.
2. Download the exact `.tgz` artifact outside the repository.
3. Verify the package version and Apache-2.0 license inside the archive.
4. Calculate SHA-256 and compare it with the expected reviewed artifact.
5. Replace the tarball and update the version, source URL, hash, and date here.
6. Update the exact `file:vendor/...` dependency in `package.json`.
7. Regenerate `package-lock.json` with the normal npm workflow.
8. Run clean `npm ci`, security audit, focused spreadsheet tests, application
   validation, production build, and the Docker build before review.

Never replace this file with an unverified artifact or a tarball obtained from
an unofficial mirror.
