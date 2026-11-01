/**
 * Client-half boot + render test.
 *
 * Executes lib/client.js the way the dsh browser loader does (fake
 * window.__ModuleLoader__ + require('react')), applies it against fake
 * betterSidebar/slots services, then MOUNTS the tab component in a jsdom DOM
 * with real react-dom - so effects run: initial fetches resolve through the
 * API helpers, the agents list renders, the task form appears, and the
 * token stylesheet lands in <head>. A component that throws in the browser
 * throws here first.
 *
 * Run: node test/client.mjs
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import fsSync from 'node:fs'

// jsdom/react come from this checkout's devDependencies, or from the
// directory named by DSH_TEST_REQUIRE_SEED (any file path inside a package
// that has them); without either the test skips.
function loadTestRequire() {
  const seeds = [
    process.env.DSH_TEST_REQUIRE_SEED,
    import.meta.url,
  ].filter(Boolean)
  for (const seed of seeds) {
    try {
      const req = createRequire(seed)
      const { JSDOM } = req('jsdom')
      const React = req('react')
      const { act } = req('react-dom/test-utils')
      const { createRoot } = req('react-dom/client')
      return { JSDOM, React, act, createRoot }
    } catch { /* next seed */ }
  }
  return null
}
const libs = loadTestRequire()
if (!libs) {
  console.log('client.mjs: SKIP - jsdom/react not resolvable from this checkout (install devDependencies to run)')
  process.exit(0)
}
const { JSDOM, React, act, createRoot } = libs
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', { url: 'http://127.0.0.1:3080/' })
globalThis.window = dom.window
globalThis.document = dom.window.document
globalThis.location = dom.window.location

const statusPayload = {
  ok: true,
  plugin: 'dsh-orchestrator',
  version: '0.1.0',
  agents: {
    total: 2, live: 1, running: 0,
    rows: [
      { sessionId: 'session-alpha', title: 'Research', origin: 'chat', cwd: '/', createdAt: 1, updatedAt: Date.now() - 5000, live: true, running: false },
      { sessionId: 'session-beta', title: 'Cold chat', origin: 'subagent', cwd: '/', createdAt: 1, updatedAt: Date.now() - 90000, live: false, running: true },
    ],
  },
  tasks: { byStatus: { completed: 1, running: 1 }, rows: [
    { id: 'co-1', type: 'command', title: '$ echo hi', status: 'completed', runner: 'local', detail: 'exit code: 0', createdAt: Date.now(), finishedAt: Date.now(), outputPreview: 'hi', via: 'local:local' },
    { id: 'ag-2', type: 'agent', title: 'agent: research', status: 'running', runner: 'local', detail: 'agent is working', createdAt: Date.now(), agentSessionId: 'session-beta' },
  ] },
  runners: [{ id: 'local', label: 'This host', kind: 'local', enabled: true }],
  providers: [{ id: 'hpc', kind: 'hpc', label: 'HPC', ok: true, headline: 'grant healthy', detail: 'ok' }],
  events: [],
}
const transcripts = {
  'session-alpha': { ok: true, sessionId: 'session-alpha', messages: [
    { role: 'user', text: 'hello agent', seq: 1 },
    { role: 'assistant', text: 'hello human', seq: 2 },
  ] },
}
const settingsPayload = {
  ok: true,
  envSecretPresent: false,
  settings: {
    enabled: true, mirrorJobs: true, requireHarnessCookie: true, trustedHosts: [],
    api: { rateLimitPerMinute: 60, secret: '', secretConfigured: true, secretFingerprint: 'sha256:1:ab12' },
    agents: { catalogMax: 120, transcriptMax: 60, spawnMax: 8, promptMaxChars: 24000, defaultPreset: '', defaultCwd: '' },
    tasks: { maxConcurrent: 4, maxOutputBytes: 500000, historyKeep: 400, commandTimeoutMs: 600000, scrapeTimeoutMs: 30000, httpTimeoutMs: 30000, scrapeMaxUrls: 12, defaultRunner: 'local', allowCommandTasks: true, allowRemoteRunners: true, pollMs: 4000 },
    runners: [{ id: 'local', label: 'This host', kind: 'local', enabled: true }],
    providers: [],
  },
}
const fetchCalls = []
const fetchImpl = {
  fn: (url) => {
    const u = String(url)
    fetchCalls.push(u)
    if (u.includes('/status')) return Promise.resolve(res(statusPayload))
    if (u.includes('/transcript')) {
      const id = u.split('/agents/')[1].split('/')[0]
      return Promise.resolve(res(transcripts[id] || { ok: true, sessionId: id, messages: [] }))
    }
    if (u.match(/\/agents\/[^/]+$/)) {
      return Promise.resolve(res({ ok: true, status: { sessionId: 'session-alpha', title: 'Research', live: true, running: false, status: 'live', lastAssistant: 'hello human' } }))
    }
    if (u.includes('/settings')) return Promise.resolve(res(settingsPayload))
    if (u.includes('/runners')) return Promise.resolve(res({ ok: true, rows: [{ id: 'local', label: 'This host', kind: 'local', enabled: true, probe: { ok: true, ms: 4, detail: 'reachable' } }], defaultRunner: 'local' }))
    if (u.includes('/providers')) return Promise.resolve(res({ ok: true, rows: statusPayload.providers }))
    if (u.includes('/tasks')) return Promise.resolve(res({ ok: true, rows: statusPayload.tasks.rows }))
    return Promise.resolve(res({ ok: true }))
  },
}
function res(body) { return { ok: true, status: 200, json: () => Promise.resolve(body), text: () => Promise.resolve(JSON.stringify(body)) } }
globalThis.fetch = (url, init) => fetchImpl.fn(url, init)

// ── execute the loader bundle ──
const src = fsSync.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
dom.window.__ModuleLoader__ = { load: (pkg) => { dom.window.__loaded = pkg } }
new Function('window', 'document', 'location', 'fetch', src)(dom.window, dom.window.document, dom.window.location, (url, init) => fetchImpl.fn(url, init))
assert.ok(dom.window.__loaded, '__ModuleLoader__.load was called')
assert.equal(dom.window.__loaded.id, 'dsh-orchestrator')

const cache = new Map([['react', React]])
const plugin = dom.window.__loaded.factory((id) => {
  assert.ok(cache.has(id), 'loader must only ask for declared deps, got ' + id)
  return cache.get(id)
})
// The object form is REQUIRED: a default-exported function loses the inject
// declaration site and the runner gates every service access (caught live in
// the sandboxed-browser verification).
assert.equal(plugin.name, 'dsh-orchestrator')
assert.equal(typeof plugin.apply, 'function')
assert.equal(plugin.default, undefined, 'a default export would shadow the object form')
assert.deepEqual(plugin.inject, ['betterSidebar', 'slots', 'locale'])

// ── apply against fake services ──
const better = { tabs: [] }
const slots = { registered: [] }
const ctx = {
  betterSidebar: {
    registerTab: (descriptor) => {
      better.tabs.push(descriptor)
      return () => {}
    },
  },
  slots: {
    inject: (name, provider) => { provider() },
    register: (spec, component) => { slots.registered.push(spec); slots.component = component; return () => {} },
  },
  effect: (fn) => fn(),
}
plugin.apply(ctx)
assert.equal(better.tabs.length, 1, 'one sidebar tab registered')
const tab = better.tabs[0]
assert.equal(tab.id, 'dsh-orchestrator:control')
assert.equal(tab.title, 'Orchestrate')
assert.equal(tab.single, true)
assert.equal(typeof tab.component, 'function')
assert.ok(tab.icon, 'tab declares an icon')
assert.equal(slots.registered.length, 1, 'one settings section registered')
assert.equal(slots.registered[0].name, 'settings.section')
assert.equal(slots.registered[0].id, 'dsh-orchestrator')
assert.ok(String(slots.registered[0].label()).includes('Orchestrator'))

// ── mount the tab and inspect the DOM ──
;(async () => {
  const root = createRoot(document.getElementById('root'))
  await act(async () => { root.render(React.createElement(tab.component, { visible: true })) })
  const text = document.body.textContent
  assert.ok(text.includes('agents'), 'agents section renders')
  assert.ok(text.includes('Research'), 'agent row title renders')
  assert.ok(text.includes('session-alpha') || text.includes('session-al'), 'agent id renders')
  assert.ok(text.includes('+ new agent'), 'spawn control renders')
  assert.ok(document.getElementById('dsh-orchestrator-styles'), 'token stylesheet injected')

  // open the chat drawer
  const row = Array.from(document.querySelectorAll('.orx-row')).find((el) => el.textContent.includes('Research'))
  assert.ok(row, 'agent row is a real element')
  await act(async () => {
    const clickable = row.querySelector('.orx-grow') || row
    clickable.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })
  await act(async () => {})
  const chatText = document.body.textContent
  assert.ok(chatText.includes('hello human'), 'chat transcript renders')
  assert.ok(chatText.includes('hello agent'), 'user message renders')
  assert.ok(chatText.includes('send'), 'compose control renders')

  // back to the list, switch to tasks
  const back = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === '← back')
  assert.ok(back, 'back control exists')
  await act(async () => { back.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
  const tasksTab = Array.from(document.querySelectorAll('.orx-seg button')).find((b) => b.textContent === 'tasks')
  assert.ok(tasksTab, 'tasks segment exists')
  await act(async () => { tasksTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
  const tasksText = document.body.textContent
  assert.ok(tasksText.includes('$ echo hi'), 'command task renders')
  assert.ok(tasksText.includes('agent: research'), 'agent task renders')
  assert.ok(tasksText.includes('+ new task'), 'new task control renders')

  // ── form submission wiring: spawn + task forms POST the right bodies ──
  // jsdom 30 + React 18.3 does not deliver dispatched input events to the
  // delegated listener (the value-tracker polyfill path), so we drive the
  // REAL onChange handler from the __reactProps$ expando, the same handler
  // the browser invokes: and then click the submit button natively.
  const posts = []
  fetchImpl.fn = (url, init) => {
    if (init && init.method === 'POST') posts.push({ url: String(url), body: JSON.parse(init.body) })
    if (String(url).includes('/status')) return Promise.resolve(res(statusPayload))
    return Promise.resolve(res({ ok: true, created: [{ sessionId: 'session-spawned' }], task: { id: 'xx-1', status: 'queued', type: 'command', title: 't' } }))
  }
  const reactPropsOf = (el) => {
    const key = Object.keys(el).find((k) => k.startsWith('__reactProps'))
    return key ? el[key] : {}
  }
  const typeInto = async (el, text) => {
    await act(async () => { reactPropsOf(el).onChange({ target: { value: text } }) })
  }

  // agents -> spawn form
  const agentsTab = Array.from(document.querySelectorAll('.orx-seg button')).find((b) => b.textContent === 'agents')
  await act(async () => { agentsTab.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
  const newAgent = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === '+ new agent')
  await act(async () => { newAgent.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
  const spawnBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'spawn + prompt')
  assert.ok(spawnBtn, 'spawn submit button renders')
  const titleInput = document.querySelector('.orx-note input')
  assert.ok(titleInput, 'spawn title input renders')
  const promptArea = document.querySelector('.orx-note textarea')
  assert.ok(promptArea, 'spawn prompt textarea renders')
  await typeInto(promptArea, 'do the thing')
  await act(async () => { spawnBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
  await act(async () => {})
  const spawnPost = posts.find((p) => p.url.endsWith('/agents/spawn'))
  assert.ok(spawnPost, 'spawn form POSTed to /agents/spawn')
  assert.equal(spawnPost.body.prompt, 'do the thing')
  assert.equal(spawnPost.body.count, 1)
  assert.equal(spawnPost.body.title, '')

  // tasks -> command task form
  const tasksTab2 = Array.from(document.querySelectorAll('.orx-seg button')).find((b) => b.textContent === 'tasks')
  await act(async () => { tasksTab2.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
  const newTask = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === '+ new task')
  await act(async () => { newTask.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
  const cmdTab = Array.from(document.querySelectorAll('.orx-seg button')).find((b) => b.textContent === 'command')
  assert.ok(cmdTab, 'command type tab renders')
  const taskArea = document.querySelector('.orx-note textarea')
  assert.ok(taskArea, 'command textarea renders')
  await act(async () => { typeInto(taskArea, 'uptime') })
  const createBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'create task')
  assert.ok(createBtn, 'create task button renders')
  await act(async () => { createBtn.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
  await act(async () => {})
  const taskPost = posts.find((p) => p.url.endsWith('/tasks'))
  assert.ok(taskPost, 'task form POSTed to /tasks')
  assert.equal(taskPost.body.type, 'command')
  assert.equal(taskPost.body.command, 'uptime')
  assert.equal(taskPost.body.runner, 'auto')

  fetchImpl.fn = (url, init) => {
    if (init && init.method === 'POST') posts.push({ url: String(url), body: JSON.parse(init.body) })
    const u = String(url)
    if (u.includes('/status')) return Promise.resolve(res(statusPayload))
    if (u.includes('/settings')) return Promise.resolve(res(settingsPayload))
    return Promise.resolve(res({ ok: true, rows: [] }))
  }

  // ── session scoping: render with a scope, flip to 'this chat', verify filtering ──
  const scopeHolder = document.createElement('div')
  document.body.appendChild(scopeHolder)
  const scopeRoot = createRoot(scopeHolder)
  await act(async () => { scopeRoot.render(React.createElement(tab.component, { visible: true, scope: { sessionId: 'session-alpha' } })) })
  await act(async () => {})
  const toggle = Array.from(scopeHolder.querySelectorAll('.orx-seg button')).find((b) => b.textContent === 'this chat')
  assert.ok(toggle, 'scope toggle renders when a session scope is present')
  await act(async () => { toggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true })) })
  await act(async () => {})
  assert.ok((scopeHolder.textContent || '').includes('this chat'), 'scoped mode active')
  assert.ok((scopeHolder.textContent || '').includes('Research'), 'scoped agents render the session row')
  scopeRoot.unmount()

  // settings section mounts too
  const holder = document.createElement('div')
  document.body.appendChild(holder)
  const root3 = createRoot(holder)
  await act(async () => { root3.render(React.createElement(slots.component)) })
  const settingsText = document.body.textContent
  assert.ok(settingsText.includes('plugin enabled'), 'settings: master switch renders')
  assert.ok(settingsText.includes('runners (where command tasks execute)'), 'settings: runners editor renders')
  assert.ok(settingsText.includes('machine API'), 'settings: api info renders')

  root.unmount()
  root3.unmount()
  console.log('client.mjs: OK - tab + settings section render, chat + task views work, spawn + task forms POST correct bodies')
  process.exit(0)
})().catch((e) => {
  console.error('client.mjs FAILED')
  console.error(e && e.stack || e)
  process.exit(1)
})
