import { z } from 'zod';
import { createHash } from 'node:crypto';
// Local implementation of CIS runtime evidence v1. Maintenance ABI v3 is unchanged.
const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/u);
const sha = z.string().regex(/^[a-f0-9]{64}$/u);
const counter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
// Plugin logic pages are isolated renderers too. Observe every renderer; do not
// truncate to the old eight-process preflight budget. 64 entries fit the 16 KiB
// runtime collector limit. Preflight retains its smaller termination-message cap.
export const MAX_RUNTIME_RENDERERS = 64;
export const MAX_PREFLIGHT_RENDERERS = 8;
export const preflightBindingSchema = z.strictObject({version:z.literal(1),purpose:z.literal('cis-profile-preflight'),
 pilotSha256:sha,layoutSha256:sha,sourcePodUid:id,pvcUid:id,sourceTemplateSha256:sha,
 recoveryScope:z.literal('image-and-cindy-resource'),credentials:z.literal('synthetic-only')});
const processSchema = z.strictObject({pid:z.number().int().positive(),startTicks:counter,seccomp:z.literal(2),
 filters:z.number().int().positive(),noNewPrivs:z.literal(1),capEff:z.literal('0000000000000000')});
const sandboxFor = (maximum: number) => z.strictObject({browser:processSchema,renderers:z.array(processSchema).min(1).max(maximum),
 rendererDiscovery:z.literal('cdp-system-info'),pageReadback:z.literal('exact')}).superRefine((v,c)=>{
 const pids=[v.browser.pid,...v.renderers.map(p=>p.pid)];
 if(new Set(pids).size!==pids.length||v.renderers.some(p=>p.filters<=v.browser.filters))
 c.addIssue({code:z.ZodIssueCode.custom,message:'additional renderer sandbox required'});
});
export const sandboxSchema = sandboxFor(MAX_RUNTIME_RENDERERS);
export const preflightSandboxSchema = sandboxFor(MAX_PREFLIGHT_RENDERERS);
export const canonicalObservationSchema = z.strictObject({source:z.enum(['canonical','legacy-cindy-four-keys']),
 backend:z.literal('gnome-libsecret'),sessionId:id,durableRefreshSequence:counter,durableAtMs:counter,
 typ:z.literal('access'),aud:z.literal('cindy'),sub:id,deviceId:id,accountControl:z.literal(false),expiresAtMs:counter});
export const readinessSchema = z.strictObject({auth:z.literal('ready'),database:z.literal('ready'),binaries:z.literal('ready'),
 maker:z.literal('ready'),deviceLink:z.literal('ready')});
export const telemetrySchema = z.strictObject({version:z.literal(1),deviceId:id,membershipId:id,realm:z.enum(['cn','global']),
 authBaseUrl:z.string().url(),profile:id,role:z.enum(['candidate','recovery']),heartbeatAtMs:counter,
 process:z.strictObject({pid:z.number().int().positive(),startTicks:counter}),canonical:canonicalObservationSchema,
 readiness:readinessSchema});
export const runtimeEvidenceSchema = telemetrySchema.extend({sandbox:sandboxSchema}).strict();
const preflightBase = z.strictObject({version:z.literal(1),bindingSha256:sha,podUid:id,observedAtMs:counter,
 architecture:z.enum(['amd64','arm64']),sandbox:preflightSandboxSchema});
export const preflightEvidenceSchema = z.discriminatedUnion('role',[
 preflightBase.extend({role:z.literal('candidate'),checks:z.strictObject({canonicalWithoutB:z.literal(true),missingCanonicalRejected:z.literal(true),
 wrongKeyRejected:z.literal(true),sharedKeyringAcrossHomes:z.literal(true)})}).strict(),
 preflightBase.extend({role:z.literal('recovery'),checks:z.strictObject({legacyAsarWithSecureWrapper:z.literal(true),currentResourceAccepted:z.literal(true),
 refreshCycles:counter.min(2),sharedKeyringAcrossHomes:z.literal(true)})}).strict(),
 preflightBase.extend({role:z.literal('maintenance'),checks:z.strictObject({latestDurableForward:z.literal(true),latestCanonicalReverse:z.literal(true),
 sourceUnchanged:z.literal(true),cindyOnlyRecovery:z.literal(true),wrongKeyRejected:z.literal(true)})}).strict(),
]);
export function evidenceDigest(value:unknown):string {
 const sorted=(v:unknown):unknown=>Array.isArray(v)?v.map(sorted):v&&typeof v==='object'
 ?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,sorted(x)])):v;
 return createHash('sha256').update(JSON.stringify(sorted(value))).digest('hex');
}
export const SANDBOX_PAGE_TEXT='cindy-profile-sandbox-v1';
export const SANDBOX_PAGE_URL='data:text/html;charset=utf-8,'+encodeURIComponent('<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'"><body>'+SANDBOX_PAGE_TEXT+'</body>');
