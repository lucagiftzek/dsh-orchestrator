/**
 * dsh-orchestrator: configuration, defaults and pure helpers.
 *
 * Everything an operator can tune lives here and is resolved from (in order):
 *   1. the cordis config row (- id: dsh-orchestrator / config: {...}),
 *   2. the settings namespace written by the Settings UI (same schema),
 * both sanitized through the same code path, so a bad value from either
 * source degrades to a safe default instead of breaking the boot.
 *
 * No hostnames, paths, commands or credentials are hardcoded: the defaults
 * describe ONLY this plugin's own behaviour (limits, timings, paths under
 * the user's DSH home). Runners, providers, presets and the API secret are
 * operator-declared state, never defaults.
 */

'use strict'

import { join } from 'node:path'
import { homedir } from 'node:os'

export const PLUGIN_ID = 'dsh-orchestrator'
export const ROW_ID = 'dsh-orchestrator'          // cordis row id (kill-switch handle)
export const SETTINGS_NS = PLUGIN_ID               // must match /^[a-z][a-z0-9-]*$/
export const API_PREFIX = '/' + PLUGIN_ID + '/api'
export const VERSION = '0.1.0'
export const SECRET_ENV = 'DSH_ORCHESTRATOR_SECRET'
export const DISABLE_ENV = 'DSH_ORCHESTRATOR_DISABLE'
export const TOOLS_ENV = 'DSH_ORCHESTRATOR_TOOLS_MAIN'

export const DEFAULTS = {
  enabled: true,
  /** Plugin-owned runtime state (tasks, events). Never inside a repo.
   * Resolved under DSH_HOME when the deployment sets it. */
  stateDir: join(homedir(), '.dsh', 'dsh-orchestrator'),
  /** Loopback is always trusted; extra authorities for the public edge. */
  trustedHosts: [],
  /** Presence of the harness browser-session cookie on UI mutations. */
  requireHarnessCookie: true,
  api: {
    rateLimitPerMinute: 60,   // per source IP, machine-secret endpoints
    secret: '',               // '' = rely on env, or fail closed
  },
  agents: {
    catalogMax: 120,          // rows kept in the merged live+cold catalog
    catalogTtlMs: 8000,       // catalog rebuild cache
    transcriptMax: 60,        // messages returned per transcript read
    transcriptTailChars: 4000,
    defaultPreset: '',        // '' = the deployment default (no explicit preset)
    defaultCwd: '',           // '' = server default cwd
    spawnMax: 8,              // fan-out cap for one agent_spawn call
    promptMaxChars: 24000,
  },
  tasks: {
    maxConcurrent: 4,         // engine-wide live task cap; extra tasks queue
    maxOutputBytes: 512 * 1024,
    historyKeep: 400,         // finished tasks kept on disk (newest first)
    historyPruneSeconds: 14 * 24 * 3600,
    commandTimeoutMs: 10 * 60 * 1000,
    scrapeTimeoutMs: 30 * 1000,
    httpTimeoutMs: 30 * 1000,
    scrapeMaxUrls: 12,
    scrapeMaxBytes: 2 * 1024 * 1024,
    /** Where a task runs when it does not name a runner. */
    defaultRunner: 'local',
    allowCommandTasks: true,
    allowRemoteRunners: true,
    pollMs: 4000,             // agent-task status poll cadence
  },
  /** Best-effort mirror of tasks into ctx.jobs so they also show in the
   * built-in Background Tasks tab. Degrades to off on first failure. */
  mirrorJobs: true,
  /** Remote execution targets. kinds: local | ssh | http. */
  runners: [
    { id: 'local', label: 'This host', kind: 'local', enabled: true },
  ],
  /** External status/tool integrations. kinds: hpc | http. */
  providers: [],
}

/** Hard bounds, independent of anything any client renders, curl exists. */
export const LIMITS = {
  bodyBytes: 256 * 1024,
  idChars: 200,
  labelChars: 200,
  titleChars: 300,
  promptChars: 24000,
  commandChars: 20000,
  urlChars: 2048,
  secretMin: 16,
  secretMax: 256,
  runnersMax: 32,
  providersMax: 32,
  tasksMax: 2000,
  eventsKeep: 4000,
  eventTail: 120,
  concurrent: [1, 64],
  timeoutMs: [500, 6 * 60 * 60 * 1000],
  historyKeep: [10, 5000],
  catalogMax: [10, 1000],
  spawnMax: [1, 32],
  rateLimit: [1, 6000],
}

export const RUNNER_KINDS = ['local', 'ssh', 'http']
export const PROVIDER_KINDS = ['hpc', 'http']
export const TASK_TYPES = ['command', 'scrape', 'http', 'agent']

const ID_SAFE_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/

// ── pure helpers (exported for tests) ──────────────────────────────────────

export function str(v, cap) {
  return typeof v === 'string' ? v.slice(0, cap) : ''
}

export function clamp(n, min, max) {
  if (!Number.isFinite(n)) return min
  return Math.min(max, Math.max(min, Math.floor(n)))
}

export function bounded(n, dflt, [min, max]) {
  return Number.isFinite(n) ? clamp(n, min, max) : dflt
}

export function isSafeId(v) {
  return typeof v === 'string' && v.length <= LIMITS.idChars && ID_SAFE_RE.test(v)
}

export function nowMs() { return Date.now() }

/** Uniform-ish short id for tasks/events (not a security boundary). */
let idCounter = 0
export function mintId(prefix = 't') {
  idCounter = (idCounter + 1) % 1000
  const t = Date.now().toString(36)
  const r = Math.floor(Math.random() * 1679616).toString(36).padStart(4, '0')
  return prefix + '-' + t + '-' + r + String(idCounter).padStart(3, '0')
}

// ── runner / provider sanitization ─────────────────────────────────────────

/**
 * Validate + sanitize one runner entry. Returns null when unusable.
 * The SSH kind stores only a target alias + option flags, the command
 * ALWAYS arrives per-task and is passed as a single argv element (never
 * interpolated into a shell string on this side).
 */
export function sanitizeRunner(entry) {
  if (!entry || typeof entry !== 'object') return null
  const id = str(entry.id, LIMITS.idChars).trim().toLowerCase()
  if (!id || !ID_SAFE_RE.test(id)) return null
  const kind = RUNNER_KINDS.includes(entry.kind) ? entry.kind : null
  if (!kind) return null
  const runner = {
    id,
    label: str(entry.label, LIMITS.labelChars).trim() || id,
    kind,
    enabled: entry.enabled !== false,
  }
  if (kind === 'ssh') {
    const target = str(entry.ssh && entry.ssh.target, 300).trim()
    if (!target || /[\n\r\0]/.test(target)) return null
    runner.ssh = {
      target,
      bin: str(entry.ssh && entry.ssh.bin, 120).trim() || 'ssh',
      connectTimeoutMs: bounded(entry.ssh && entry.ssh.connectTimeoutMs, 10, LIMITS.timeoutMs),
      extraArgs: Array.isArray(entry.ssh && entry.ssh.extraArgs)
        ? (entry.ssh.extraArgs).map((a) => str(a, 200)).filter(Boolean).slice(0, 12)
        : [],
    }
  }
  if (kind === 'http') {
    const url = str(entry.http && entry.http.url, LIMITS.urlChars).trim()
    if (!/^https?:\/\//i.test(url)) return null
    runner.http = {
      url,
      method: ['POST', 'PUT'].includes(String(entry.http && entry.http.method).toUpperCase())
        ? String(entry.http.method).toUpperCase() : 'POST',
      timeoutMs: bounded(entry.http && entry.http.timeoutMs, DEFAULTS.tasks.httpTimeoutMs, LIMITS.timeoutMs),
      /** Name of an env var read at CALL time for the auth header (never stored). */
      secretEnv: str(entry.http && entry.http.secretEnv, 120).trim(),
    }
  }
  return runner
}

/**
 * Validate + sanitize one provider entry. Returns null when unusable.
 * kind 'hpc' understands the HPC allocation status contract (/health, /state);
 * kind 'http' is a generic JSON status endpoint.
 */
export function sanitizeProvider(entry) {
  if (!entry || typeof entry !== 'object') return null
  const id = str(entry.id, LIMITS.idChars).trim().toLowerCase()
  if (!id || !ID_SAFE_RE.test(id)) return null
  const kind = PROVIDER_KINDS.includes(entry.kind) ? entry.kind : null
  if (!kind) return null
  const url = str(entry.url, LIMITS.urlChars).trim()
  if (!/^https?:\/\//i.test(url)) return null
  return {
    id,
    label: str(entry.label, LIMITS.labelChars).trim() || id,
    kind,
    url: url.replace(/\/+$/, ''),
    enabled: entry.enabled !== false,
    pollSeconds: bounded(entry.pollSeconds, 60, [5, 3600]),
    secretEnv: str(entry.secretEnv, 120).trim(),
  }
}

// ── full config resolution ─────────────────────────────────────────────────

function mergeList(raw, sanitize, max, ids = new Set()) {
  if (!Array.isArray(raw)) return []
  const out = []
  for (const entry of raw.slice(0, max)) {
    const clean = sanitize(entry)
    if (!clean || ids.has(clean.id)) continue
    ids.add(clean.id)
    out.push(clean)
  }
  return out
}

/**
 * The built-in 'local' runner always exists (it names THIS host, which is
 * not a secret and not a hardcoded remote); operator entries merge on top
 * and an operator entry with id 'local' can override or disable it.
 */
function resolveRunners(raw) {
  const ids = new Set()
  const base = mergeList(DEFAULTS.runners, sanitizeRunner, LIMITS.runnersMax, ids)
  const extra = mergeList(raw, sanitizeRunner, LIMITS.runnersMax, ids)
  return [...base, ...extra]
}

export function dshHomeDir() {
  return process.env.DSH_HOME ? process.env.DSH_HOME : join(homedir(), '.dsh')
}

export function resolveConfig(config = {}) {
  const c = config && typeof config === 'object' ? config : {}
  const api = c.api && typeof c.api === 'object' ? c.api : {}
  const agents = c.agents && typeof c.agents === 'object' ? c.agents : {}
  const tasks = c.tasks && typeof c.tasks === 'object' ? c.tasks : {}
  const runners = resolveRunners(c.runners)
  const providers = mergeList(c.providers, sanitizeProvider, LIMITS.providersMax)
  return {
    ...DEFAULTS,
    ...c,
    stateDir: typeof c.stateDir === 'string' && c.stateDir.startsWith('/')
      ? c.stateDir
      : join(dshHomeDir(), 'dsh-orchestrator'),
    enabled: c.enabled !== false,
    trustedHosts: Array.isArray(c.trustedHosts)
      ? c.trustedHosts.filter((h) => typeof h === 'string' && h.length > 0).slice(0, 32) : [],
    requireHarnessCookie: c.requireHarnessCookie !== false,
    api: {
      rateLimitPerMinute: bounded(api.rateLimitPerMinute, DEFAULTS.api.rateLimitPerMinute, LIMITS.rateLimit),
      secret: str(api.secret, LIMITS.secretMax).trim(),
    },
    agents: {
      ...DEFAULTS.agents,
      ...agents,
      catalogMax: bounded(agents.catalogMax, DEFAULTS.agents.catalogMax, LIMITS.catalogMax),
      transcriptMax: bounded(agents.transcriptMax, DEFAULTS.agents.transcriptMax, [5, 500]),
      spawnMax: bounded(agents.spawnMax, DEFAULTS.agents.spawnMax, LIMITS.spawnMax),
      promptMaxChars: bounded(agents.promptMaxChars, DEFAULTS.agents.promptMaxChars, [100, 100000]),
      defaultPreset: str(agents.defaultPreset, 120).trim(),
      defaultCwd: str(agents.defaultCwd, 4096).trim(),
    },
    tasks: {
      ...DEFAULTS.tasks,
      ...tasks,
      maxConcurrent: bounded(tasks.maxConcurrent, DEFAULTS.tasks.maxConcurrent, LIMITS.concurrent),
      maxOutputBytes: bounded(tasks.maxOutputBytes, DEFAULTS.tasks.maxOutputBytes, [1024, 16 * 1024 * 1024]),
      historyKeep: bounded(tasks.historyKeep, DEFAULTS.tasks.historyKeep, LIMITS.historyKeep),
      commandTimeoutMs: bounded(tasks.commandTimeoutMs, DEFAULTS.tasks.commandTimeoutMs, LIMITS.timeoutMs),
      scrapeTimeoutMs: bounded(tasks.scrapeTimeoutMs, DEFAULTS.tasks.scrapeTimeoutMs, LIMITS.timeoutMs),
      httpTimeoutMs: bounded(tasks.httpTimeoutMs, DEFAULTS.tasks.httpTimeoutMs, LIMITS.timeoutMs),
      scrapeMaxUrls: bounded(tasks.scrapeMaxUrls, DEFAULTS.tasks.scrapeMaxUrls, [1, 64]),
      scrapeMaxBytes: bounded(tasks.scrapeMaxBytes, DEFAULTS.tasks.scrapeMaxBytes, [1024, 64 * 1024 * 1024]),
      defaultRunner: typeof tasks.defaultRunner === 'string' && tasks.defaultRunner.trim()
        ? tasks.defaultRunner.trim() : DEFAULTS.tasks.defaultRunner,
      allowCommandTasks: tasks.allowCommandTasks !== false,
      allowRemoteRunners: tasks.allowRemoteRunners !== false,
      pollMs: bounded(tasks.pollMs, DEFAULTS.tasks.pollMs, [500, 60000]),
    },
    mirrorJobs: c.mirrorJobs === true,
    runners,
    providers,
  }
}

/**
 * Build a sanitized settings patch from a raw settings PUT body (Settings UI
 * or machine API). Unknown keys drop; the secret is handled only by the
 * dedicated /secret route so it can never echo through a settings read.
 */
export function sanitizeSettingsPatch(body) {
  const patch = {}
  if (body == null || typeof body !== 'object' || Array.isArray(body)) return patch
  if (typeof body.enabled === 'boolean') patch.enabled = body.enabled
  if (typeof body.requireHarnessCookie === 'boolean') patch.requireHarnessCookie = body.requireHarnessCookie
  if (typeof body.mirrorJobs === 'boolean') patch.mirrorJobs = body.mirrorJobs
  if (Array.isArray(body.trustedHosts)) {
    patch.trustedHosts = body.trustedHosts
      .filter((h) => typeof h === 'string' && h.length > 0 && h.length <= 200)
      .slice(0, 32)
  }
  if (body.api && typeof body.api === 'object' && !Array.isArray(body.api)) {
    const api = {}
    if (Number.isFinite(body.api.rateLimitPerMinute)) {
      api.rateLimitPerMinute = clamp(body.api.rateLimitPerMinute, ...LIMITS.rateLimit)
    }
    if (Object.keys(api).length) patch.api = api
  }
  if (body.agents && typeof body.agents === 'object' && !Array.isArray(body.agents)) {
    const agents = {}
    if (Number.isFinite(body.agents.catalogMax)) agents.catalogMax = clamp(body.agents.catalogMax, ...LIMITS.catalogMax)
    if (Number.isFinite(body.agents.transcriptMax)) agents.transcriptMax = clamp(body.agents.transcriptMax, 5, 500)
    if (Number.isFinite(body.agents.spawnMax)) agents.spawnMax = clamp(body.agents.spawnMax, ...LIMITS.spawnMax)
    if (Number.isFinite(body.agents.promptMaxChars)) agents.promptMaxChars = clamp(body.agents.promptMaxChars, 100, 100000)
    if (typeof body.agents.defaultPreset === 'string') agents.defaultPreset = str(body.agents.defaultPreset, 120).trim()
    if (typeof body.agents.defaultCwd === 'string') agents.defaultCwd = str(body.agents.defaultCwd, 4096).trim()
    if (Object.keys(agents).length) patch.agents = agents
  }
  if (body.tasks && typeof body.tasks === 'object' && !Array.isArray(body.tasks)) {
    const tasks = {}
    if (Number.isFinite(body.tasks.maxConcurrent)) tasks.maxConcurrent = clamp(body.tasks.maxConcurrent, ...LIMITS.concurrent)
    if (Number.isFinite(body.tasks.maxOutputBytes)) tasks.maxOutputBytes = clamp(body.tasks.maxOutputBytes, 1024, 16 * 1024 * 1024)
    if (Number.isFinite(body.tasks.historyKeep)) tasks.historyKeep = clamp(body.tasks.historyKeep, ...LIMITS.historyKeep)
    if (Number.isFinite(body.tasks.commandTimeoutMs)) tasks.commandTimeoutMs = clamp(body.tasks.commandTimeoutMs, ...LIMITS.timeoutMs)
    if (Number.isFinite(body.tasks.scrapeTimeoutMs)) tasks.scrapeTimeoutMs = clamp(body.tasks.scrapeTimeoutMs, ...LIMITS.timeoutMs)
    if (Number.isFinite(body.tasks.httpTimeoutMs)) tasks.httpTimeoutMs = clamp(body.tasks.httpTimeoutMs, ...LIMITS.timeoutMs)
    if (Number.isFinite(body.tasks.scrapeMaxUrls)) tasks.scrapeMaxUrls = clamp(body.tasks.scrapeMaxUrls, 1, 64)
    if (typeof body.tasks.defaultRunner === 'string' && body.tasks.defaultRunner.trim()) tasks.defaultRunner = body.tasks.defaultRunner.trim()
    if (typeof body.tasks.allowCommandTasks === 'boolean') tasks.allowCommandTasks = body.tasks.allowCommandTasks
    if (typeof body.tasks.allowRemoteRunners === 'boolean') tasks.allowRemoteRunners = body.tasks.allowRemoteRunners
    if (Object.keys(tasks).length) patch.tasks = tasks
  }
  if (Array.isArray(body.runners)) {
    const ids = new Set()
    patch.runners = mergeList(body.runners.slice(0, LIMITS.runnersMax), sanitizeRunner, LIMITS.runnersMax, ids)
  }
  if (Array.isArray(body.providers)) {
    const ids = new Set()
    patch.providers = mergeList(body.providers.slice(0, LIMITS.providersMax), sanitizeProvider, LIMITS.providersMax, ids)
  }
  return patch
}

/** Settings view safe to hand to any client: secret replaced by fingerprint. */
export function safeSettings(cfg) {
  const secret = cfg.api.secret
  return {
    ...cfg,
    api: { ...cfg.api, secret: '', secretConfigured: secret.length >= LIMITS.secretMin, secretFingerprint: fingerprint(secret) },
  }
}

export function fingerprint(secret) {
  if (typeof secret !== 'string' || secret.length === 0) return ''
  return 'sha256:' + secret.length + ':' + simpleHash(secret).slice(0, 12)
}

// tiny non-crypto hash for display fingerprints only (auth uses crypto in security.js)
function simpleHash(s) {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(16).padStart(8, '0')
}
