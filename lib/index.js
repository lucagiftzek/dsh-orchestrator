/**
 * dsh-orchestrator - host half entry.
 *
 * Wires, in order:
 *   1. the settings store      (Settings -> Orchestrator). DSH 0.1.5: the
 *      registered namespace `dsh-orchestrator` in settings.yaml. DSH 0.2.x: the
 *      `dsh-orchestrator` row of the profile's cordis.patch.yml (every field of
 *      the exported `Config` is live except stateDir), imported once from
 *      settings.yaml(.imported) while the row is still empty. Both through
 *      lib/dual-settings.js. JSON-file fallback when no settings service or
 *      schemastery exists (the plugin still boots - a throwing plugin entry
 *      takes the whole app down on this profile, learned the hard way).
 *   2. the task engine         (durable store under ~/.dsh/dsh-orchestrator).
 *   3. the API route           /dsh-orchestrator/api (browser + machine).
 *   4. the agent tools         orch_* (15 of them), registered only when
 *      defineTool resolves defensively from this package's location.
 *   5. the jobs mirror lookup  (best-effort ctx.jobs).
 *
 * WHY NO @deepseek-ai/* STATIC IMPORTS: they drift between releases and a
 * failed static import is a boot-killing SyntaxError, not a degradation.
 * Everything optional is resolved through ctx.get() at apply() time and
 * every seam degrades to an honest error row.
 *
 * KILL SWITCH: DSH_ORCHESTRATOR_DISABLE=1 in the dsh-web environment, or
 *   - id: dsh-orchestrator
 *     disabled: true
 * in the profile's cordis.patch.yml + restart.
 */

'use strict'

import fs from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

import { createDualSettings, loadHostSchemastery, liveObject, plain } from './dual-settings.js'
import {
  PLUGIN_ID, SETTINGS_NS, API_PREFIX, VERSION, DISABLE_ENV, TOOLS_ENV, SECRET_ENV,
  DEFAULTS, resolveConfig, sanitizeSettingsPatch, dshHomeDir,
} from './core.js'
import { TaskStore } from './store.js'
import { TaskEngine } from './tasks.js'
import { makeAgents } from './agents.js'
import { Providers } from './providers.js'
import { agentTools } from './tools.js'
import { makeHandler } from './api.js'

export const name = 'dsh-orchestrator'

/** Minimal static inject: the proven trio; everything else via ctx.get(). */
export const inject = ['agents', 'settings', 'webServer']

function dshHome() {
  return dshHomeDir()
}

// ── schemastery (defensive) ─────────────────────────────────────────────────

// The RUNNING harness's schemastery: on 0.2.x only its copy wraps live fields
// the way the Loader commits them (see lib/dual-settings.js).
function loadSchemastery() { return loadHostSchemastery(import.meta.url) }

function settingsSchema(z) {
  if (!z) return null
  const secret = (f) => (typeof f.role === 'function' ? f.role('secret') : f)
  // Every field is live (read at the moment of use, applied without a
  // remount) except stateDir, a host-level fact that stays plain row config.
  return liveObject(z, {
    stateDir: z.string().default(''),
    enabled: z.boolean().default(DEFAULTS.enabled),
    mirrorJobs: z.boolean().default(DEFAULTS.mirrorJobs),
    requireHarnessCookie: z.boolean().default(DEFAULTS.requireHarnessCookie),
    trustedHosts: z.array(z.string()).default([]),
    api: z.object({
      rateLimitPerMinute: z.number().min(1).default(DEFAULTS.api.rateLimitPerMinute),
      secret: secret(z.string().default('')),
    }).default({ rateLimitPerMinute: DEFAULTS.api.rateLimitPerMinute, secret: '' }),
    agents: z.object({
      catalogMax: z.number().min(10).default(DEFAULTS.agents.catalogMax),
      catalogTtlMs: z.number().min(0).default(DEFAULTS.agents.catalogTtlMs),
      transcriptTailChars: z.number().min(0).default(DEFAULTS.agents.transcriptTailChars),
      transcriptMax: z.number().min(5).default(DEFAULTS.agents.transcriptMax),
      spawnMax: z.number().min(1).default(DEFAULTS.agents.spawnMax),
      promptMaxChars: z.number().min(100).default(DEFAULTS.agents.promptMaxChars),
      defaultPreset: z.string().default(''),
      defaultCwd: z.string().default(''),
    }).default({ ...DEFAULTS.agents }),
    tasks: z.object({
      maxConcurrent: z.number().min(1).default(DEFAULTS.tasks.maxConcurrent),
      maxOutputBytes: z.number().min(1024).default(DEFAULTS.tasks.maxOutputBytes),
      historyKeep: z.number().min(10).default(DEFAULTS.tasks.historyKeep),
      historyPruneSeconds: z.number().min(0).default(DEFAULTS.tasks.historyPruneSeconds),
      commandTimeoutMs: z.number().min(500).default(DEFAULTS.tasks.commandTimeoutMs),
      scrapeTimeoutMs: z.number().min(500).default(DEFAULTS.tasks.scrapeTimeoutMs),
      httpTimeoutMs: z.number().min(500).default(DEFAULTS.tasks.httpTimeoutMs),
      scrapeMaxUrls: z.number().min(1).default(DEFAULTS.tasks.scrapeMaxUrls),
      scrapeMaxBytes: z.number().min(1024).default(DEFAULTS.tasks.scrapeMaxBytes),
      defaultRunner: z.string().default(DEFAULTS.tasks.defaultRunner),
      allowCommandTasks: z.boolean().default(true),
      allowRemoteRunners: z.boolean().default(true),
      pollMs: z.number().min(500).default(DEFAULTS.tasks.pollMs),
    }).default({ ...DEFAULTS.tasks }),
    runners: z.array(z.object({
      id: z.string(),
      label: z.string().default(''),
      kind: z.string().default('local'),
      enabled: z.boolean().default(true),
      ssh: z.object({
        target: z.string(),
        bin: z.string().default('ssh'),
        connectTimeoutMs: z.number().default(10000),
        extraArgs: z.array(z.string()).default([]),
      }).default(undefined),
      http: z.object({
        url: z.string(),
        method: z.string().default('POST'),
        timeoutMs: z.number().default(30000),
        secretEnv: z.string().default(''),
      }).default(undefined),
    })).default(DEFAULTS.runners),
    providers: z.array(z.object({
      id: z.string(),
      label: z.string().default(''),
      kind: z.string().default('http'),
      url: z.string(),
      enabled: z.boolean().default(true),
      pollSeconds: z.number().default(60),
      secretEnv: z.string().default(''),
    })).default([]),
  }, { fixed: ['stateDir'] })
}

/** Settings schema as the plugin's Config (0.2.x forms and row validation). */
export const Config = settingsSchema(loadSchemastery()) || undefined

// ── defineTool (defensive) ──────────────────────────────────────────────────

export function resolveDefineTool(env = process.env, log = () => {}) {
  const bases = []
  if (env[TOOLS_ENV]) bases.push(env[TOOLS_ENV])
  bases.push(import.meta.url)
  if (env.DSH_PROFILE) bases.push(join(dshHome(), 'profiles', env.DSH_PROFILE, 'probe.js'))
  bases.push(join(dshHome(), 'profiles', 'web', 'probe.js'))
  bases.push(join(dshHome(), 'profiles', 'probe.js'))
  bases.push(join(dshHome(), 'probe.js'))
  if (process.argv && process.argv[1]) bases.push(process.argv[1])
  for (const base of bases) {
    try {
      const req = createRequire(base)
      const mod = req('@deepseek-ai/dsh-tools')
      const fn = mod && (mod.defineTool || (mod.default && mod.default.defineTool))
      if (typeof fn === 'function') { log('defineTool resolved via ' + String(base)); return fn }
    } catch { /* next seed */ }
  }
  return null
}

// ── apply ───────────────────────────────────────────────────────────────────

export function apply(ctx, config = {}) {
  const log = (m) => console.log('dsh-orchestrator: ' + m)
  const warn = (m) => console.error('dsh-orchestrator: ' + m)

  if (process.env[DISABLE_ENV] === '1') {
    log(DISABLE_ENV + '=1 - armed off, nothing registered')
    return
  }

  const pluginDir = join(dshHome(), 'dsh-orchestrator')
  const fallbackSettingsFile = join(pluginDir, 'settings.json')

  // ── settings store ────────────────────────────────────────────────────
  // 0.1.5: registered namespace. 0.2.x: the row's live Config (the row IS the
  // settings). No service or no schemastery: JSON file fallback, as always.
  const schema = Config || null
  const settingsStore = createDualSettings(ctx, config, {
    ns: SETTINGS_NS,
    packageName: 'dsh-orchestrator',
    schema,
    // stateDir is a host-level fact: resolve it against DSH_HOME at apply
    // time (the import-time default would freeze the wrong value under a
    // relocated DSH_HOME, like a sandbox boot).
    base: { ...structuredCloneSafe(DEFAULTS), stateDir: join(dshHome(), 'dsh-orchestrator') },
    // The plugin ships its own Settings -> Orchestrator section (talks to the
    // route below), so no generated form next to it.
    autoForm: false,
    log, warn, metaUrl: import.meta.url,
  })
  log('settings store: ' + settingsStore.mode + (settingsStore.entryId ? ' (entry ' + settingsStore.entryId + ')' : ''))
  const useFallbackFile = settingsStore.mode === 'config'
  let settingsOverrides = {}
  let fallbackSettings = {}
  if (useFallbackFile) {
    try {
      fallbackSettings = JSON.parse(fs.readFileSync(fallbackSettingsFile, 'utf8'))
    } catch { fallbackSettings = {} }
    warn('settings service unavailable - using the JSON fallback at ' + fallbackSettingsFile)
  }

  function structuredCloneSafe(v) {
    try { return structuredClone(v) } catch { return JSON.parse(JSON.stringify(v)) }
  }

  // Schema defaults, to tell a row value the operator wrote from one the
  // Loader filled in (a plugin with a Config export gets every key defaulted
  // in apply(), on 0.1.5 as well as on 0.2.x).
  const schemaDefaults = (() => {
    if (!schema) return null
    try { return plain(schema({})) } catch { return null }
  })()
  function declaredRow(row) {
    if (!row || typeof row !== 'object' || !schemaDefaults) return row
    const out = {}
    for (const [k, v] of Object.entries(plain(row))) {
      if (k in schemaDefaults && JSON.stringify(v) === JSON.stringify(schemaDefaults[k])) continue
      out[k] = v
    }
    return out
  }

  function effective() {
    // 0.2.x: the row IS the settings, so the row layer is already inside
    // settingsStore.get(); merging it again would double-apply it.
    if (settingsStore.mode === 'forms') return resolveConfig(settingsStore.get() || {})
    let raw = {}
    if (settingsStore.mode === 'register') {
      try { raw = settingsStore.get() || {} } catch { raw = {} }
    } else {
      raw = { ...fallbackSettings, ...settingsOverrides }
    }
    // composition order: cordis row config < settings namespace
    return resolveConfig({ ...raw, ...mergeRowConfig(raw, declaredRow(config)) })
  }

  /**
   * The cordis row config is the deployment floor: anything it declares that
   * the settings namespace left untouched applies; keys the operator moved
   * into settings win. stateDir and trustedHosts are host-level facts, so
   * the row wins there.
   */
  function mergeRowConfig(current, row) {
    const out = {}
    if (!row || typeof row !== 'object') return out
    for (const [k, v] of Object.entries(row)) {
      if (k === 'stateDir' || k === 'trustedHosts') { out[k] = v; continue }
      if (current[k] === undefined) out[k] = v
    }
    if (row.runners && Array.isArray(row.runners) && !Array.isArray(current.runners)) out.runners = row.runners
    if (row.providers && Array.isArray(row.providers) && !Array.isArray(current.providers)) out.providers = row.providers
    return out
  }

  async function persistSettingsPatch(patch) {
    if (!useFallbackFile) {
      if (!settingsStore.writable()) throw new Error('settings not writable: no loader row for this plugin')
      await settingsStore.update(patch)
      return 'settings'
    }
    const merged = { ...fallbackSettings, ...settingsOverrides, ...patch }
    Object.assign(settingsOverrides, patch)
    fallbackSettings = merged
    fs.mkdirSync(pluginDir, { recursive: true })
    const tmp = fallbackSettingsFile + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(merged, null, 2) + String.fromCharCode(10), { mode: 0o600 })
    fs.renameSync(tmp, fallbackSettingsFile)
    return 'fallback-file'
  }

  // ── engine + facades ───────────────────────────────────────────────────
  // Facades take config GETTERS so every read observes live settings; the
  // engine gets a reference it re-reads through this.cfg on each method call.
  const cfgRef = () => effective()
  const cfg = cfgRef()
  const store = new TaskStore(cfg.stateDir)
  const agents = makeAgents(ctx, cfgRef, { log, warn })
  const providers = new Providers(cfgRef, { log })
  const engine = new TaskEngine(cfg, store, agents, { log, warn })
  engine.setJobsLookup(() => {
    try { return ctx.get('jobs') || null } catch { return null }
  })

  // Re-resolve the engine's config reference whenever settings change so
  // limits and runner lists apply live (agents/providers already read
  // through the getter).
  function refreshFacades() {
    engine.cfg = effective()
    engine.runners = () => engine.cfg.runners
  }
  if (!useFallbackFile) {
    try { ctx.effect(() => settingsStore.watch(() => refreshFacades()), 'dsh-orchestrator: settings watcher') } catch { /* optional */ }
  }

  void engine.boot().then(() => {
    log('engine booted - ' + engine.list({ limit: 5000 }).length + ' task(s) in history')
  }).catch((e) => warn('engine boot: ' + (e && e.message || e)))

  // ── the route ─────────────────────────────────────────────────────────
  const handler = makeHandler(cfg, {
    engine,
    agents,
    providers,
    effective,
    persistSettingsPatch,
    settingsStore: useFallbackFile ? 'fallback-file' : 'settings',
    log,
    warn,
  })
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: API_PREFIX, handler }), 'dsh-orchestrator: api route')

  // ── the tools ─────────────────────────────────────────────────────────
  // The tools registry is read through ctx.get() at apply time, NOT a static
  // inject entry: a static entry would hold activation hostage to the
  // registry (the dsh-tools maintainers' own advice for optional services),
  // while a missing registry here degrades to an honest warning.
  const toolsService = (() => { try { return ctx.get('tools') || null } catch { return null } })()
  const defineTool = resolveDefineTool(process.env, log)
  if (typeof defineTool !== 'function') {
    warn('@deepseek-ai/dsh-tools could not be resolved from this package location, so NO tools were registered. The route and the sidebar still work. Fix: install the plugin so its realpath sits under ~/.dsh/profiles, or set ' + TOOLS_ENV + ' to the dsh-tools entrypoint.')
  } else if (!toolsService || typeof toolsService.register !== 'function') {
    warn('the ctx.tools registry is unavailable in this composition, so NO tools were registered. The route and the sidebar still work.')
  } else {
    let registered = 0
    try {
      for (const def of agentTools(defineTool, {
        engine, agents, providers,
        cfg: new Proxy({}, { get: (_t, k) => effective()[k] }),
        probeRunners: (r) => import('./runners.js').then((m) => m.probeRunner(r)),
        sessionController: () => { try { return ctx.get('sessionController') || null } catch { return null } },
      })) {
        ctx.effect(() => {
          const dispose = toolsService.register(def)
          return () => { try { if (typeof dispose === 'function') dispose() } catch { /* gone */ } }
        }, 'dsh-orchestrator: tool ' + def.name)
        registered += 1
      }
    } catch (e) {
      warn('tool registration failed: ' + ((e && e.stack) || e))
    }
    log('armed - ' + registered + ' agent tool(s), route ' + API_PREFIX + ', state ' + cfg.stateDir + ', settings ' + (useFallbackFile ? 'fallback-file' : SETTINGS_NS + '/' + settingsStore.mode) + (machineSecretPresent() ? ', machine API: secret configured' : ', machine API: fail-closed (no secret)'))
  }

  function machineSecretPresent() {
    return Boolean((process.env[SECRET_ENV] || '').trim() || effective().api.secret)
  }

  // Prune finished history periodically (cheap; failures are logged once).
  const pruneTimer = setInterval(() => {
    try {
      const c = effective()
      const dropped = store.prune(c.tasks.historyKeep, c.tasks.historyPruneSeconds)
      if (dropped) void store.flush().catch(() => {})
      if (!c.enabled) return
    } catch { /* best effort */ }
  }, 10 * 60 * 1000)
  if (typeof pruneTimer.unref === 'function') pruneTimer.unref()
  ctx.effect(() => () => clearInterval(pruneTimer), 'dsh-orchestrator: prune timer')
}

export const __index = { loadSchemastery, settingsSchema, resolveDefineTool }
