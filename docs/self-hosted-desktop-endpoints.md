# Self-hosted Desktop endpoint manifests

This document describes the build-time inputs needed to package Desktop against a self-hosted,
isolated Cindy realm. The repository contains the reusable mechanism and placeholder examples only.
Real hostnames, manifest bodies, credentials, organization slugs, image digests, and resource IDs must
stay in deployment storage, an external file, or the gitignored local files described below.

## Build-time manifest bases

Packaged Desktop fetches two manifests at startup:

- `<currentManifestBaseUrl>/endpoint.json` for the build's physical auth realm;
- `<peerManifestBaseUrl>/endpoint.json` for the other physical realm, used by organization discovery.

By default, the package script derives these bases from the checked-in regional endpoint configs. A
self-hosted package can instead pass one explicit build file:

```bash
cp config/desktop-endpoint-manifest-bases.json.example \
  config/desktop-endpoint-manifest-bases.json
# Edit only the gitignored copy, then package:
pnpm release:package -- --region dev \
  --endpoint-manifest-bases-file config/desktop-endpoint-manifest-bases.json
```

Relative paths are resolved from the repository root. Absolute paths are also accepted, so a build
system can keep the file completely outside the checkout. The file is parsed before downloads or
package mutation begin. It must have `schemaVersion: 1`, both bases must be absolute credential-free
HTTPS URLs, and unknown fields are rejected.

The package command's `--region` is the **build identity** and may be `cn`, `global`, or `dev`.
Desktop OAuth still uses the hosted callback or RFC 8252 loopback described below; `cindydev://auth`
is the corresponding **Mobile-only** dev scheme. On Desktop, the `dev` identity is instead isolated
by executable name `CindyDev`, app ID `com.xd.cindydev`, and its own `CindyDev` userData directory;
the primary deep-link scheme remains the shared `cindy` (legacy `xdt-maker`). These identities are
defined in `packages/maker-shared/src/brandIdentity.ts:129-158`. In contrast, the remote
`endpoint.json` `region` field is a **physical endpoint realm**: it may be omitted, but when present
it must be `cn` or `global`, never `dev`. The manifest-base build file is stricter and always requires
that physical `region`; a `dev` build maps to the `cn` realm, so its file must say `"region": "cn"`.

The package path intentionally keeps `allowEnvOverride: false`. Ordinary
`VITE_ENDPOINT_MANIFEST_BASE_URL` or `VITE_ENDPOINT_MANIFEST_PEER_BASE_URL` shell variables cannot
silently change a packaged client's identity. The explicit file is the auditable override.

## Minimal self-hosted `endpoint.json`

Each configured base must serve a file named `endpoint.json`. For the P0 Desktop + XD SSO + one ACS
runtime + real model call, the current-realm manifest needs at least:

```json
{
  "schemaVersion": 1,
  "region": "cn",
  "authApiBaseUrl": "https://auth.dev.example.invalid",
  "deviceLinkApiBaseUrl": "https://device-link.dev.example.invalid",
  "modelAccessApiBaseUrl": "https://model-access.dev.example.invalid",
  "cloudInstanceApiBaseUrl": "https://cloud-instance.dev.example.invalid",
  "authDesktopCallbackUrl": ""
}
```

The four non-empty API bases must all belong to the same isolated development realm. The checked-in
placeholder is `config/endpoint.self-hosted.json.example`; deploy a real copy outside Git. Other
endpoint fields may be added when their services are deployed, following the shared endpoint schema.

The online fetch path accepts any valid HTTPS manifest host. Offline cached startup still has the
compile-time trust anchors in `endpointManifestCache.ts` (`cindy.com.cn` / `cindy.app`), so a package
using a self-hosted hostname cannot use the offline-start escape hatch. That limitation is deliberate
for P0; do not move the trust anchor into the manifest, userData, or runtime settings.

## Desktop OAuth callback rules

Desktop does **not** use `cindy://` as its OAuth `redirect_uri`:

- non-empty `authDesktopCallbackUrl`: this exact HTTPS value is the Desktop `redirect_uri` and must
  match the auth-server redirect allowlist or same-origin allow rule character-for-character;
- empty or missing `authDesktopCallbackUrl`: Desktop uses an RFC 8252 loopback URL such as
  `http://127.0.0.1:<random-port>/auth/callback`;
- `cindy://focus/desktop-login` is only the result page's “Return to Cindy” deep link after the OAuth
  result has already been delivered. It is not an OAuth redirect URI.

Mobile is different and is outside this P0 Desktop scope. Its native OAuth redirects are
`cindycn://auth`, `cindy://auth`, or `cindydev://auth`, selected by the Mobile build identity.

## Repository boundary

Tracked and reusable:

- the package flag and strict parser;
- `config/*.example` placeholder files;
- this documentation and tests.

Never tracked:

- `config/desktop-endpoint-manifest-bases.json` with real manifest hosts;
- `config/endpoint.self-hosted.json` or a deployed real `endpoint.json` body;
- credentials, secrets, authorization headers, real organization identifiers, image digests, or
  infrastructure resource IDs.
