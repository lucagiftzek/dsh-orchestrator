/**
 * dsh-orchestrator - browser half (source; bundled by scripts/build.mjs).
 *
 * Two surfaces:
 *   1. The "Orchestrate" tab on dsh-better-sidebar (ctx.betterSidebar.registerTab)
 *      - Agents: live+cold chats, spawn/fork/prompt/cancel, chat-style drawer
 *      - Tasks:  command/scrape/http/agent tasks with live status + output
 *      - Runners: execution targets with health probes
 *      - Providers: integration cards (HPC allocation status route, generic HTTP)
 *      - API: secret management + ready-made curl examples
 *   2. A Settings-page section (ctx.slots 'settings.section'): configuration
 *      of everything above - limits, runners, providers, secret.
 *
 * Colors come only from the --dsw-* theme token layers, so light/dark
 * follows the shell. Every mutation carries the plugin's X-Requested-With
 * header + JSON content type - the host-side CSRF guard for UI endpoints;
 * the machine endpoints are secret-only and never touched from here.
 */

import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'

const PLUGIN_ID = 'dsh-orchestrator'
const API = '/' + PLUGIN_ID + '/api'
const POLL_MS = 4000

// ── tiny token-based stylesheet ─────────────────────────────────────────────

const CSS = [
  '.orx{--ok:var(--dsw-alias-state-success-primary,#2e9e5b);--warn:var(--dsw-alias-state-warn-primary,#c98a14);',
  '  --bad:var(--dsw-alias-state-error-primary,#cf3b3b);--brand:var(--dsw-alias-state-business-primary,#4d6bfe);',
  '  --ink:var(--dsw-alias-label-primary,inherit);--ink2:var(--dsw-alias-label-secondary,inherit);',
  '  --ink3:var(--dsw-alias-label-tertiary,inherit);--line:var(--dsw-alias-border-l2,rgba(128,128,128,.28));',
  '  --line1:var(--dsw-alias-border-l1,rgba(128,128,128,.18));--l1:var(--dsw-alias-bg-layer-1,transparent);',
  '  --l2:var(--dsw-alias-bg-layer-2,rgba(128,128,128,.07));--hov:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12));',
  '  display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden;font:inherit;font-size:13px;color:var(--ink)}',
  '.orx *{box-sizing:border-box}',
  '.orx-bar{display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--line);flex:0 0 auto;flex-wrap:wrap}',
  '.orx-body{flex:1;min-height:0;overflow-y:auto;padding:10px 10px 24px}',
  '.orx-btn{font:inherit;font-size:12px;padding:4px 10px;border-radius:6px;border:1px solid var(--line);',
  '  background:transparent;color:inherit;cursor:pointer;white-space:nowrap}',
  '.orx-btn:hover:not(:disabled){background:var(--hov)}',
  '.orx-btn:disabled{opacity:.45;cursor:not-allowed}',
  '.orx-btn.p{border-color:transparent;background:var(--brand);color:var(--dsw-alias-label-primary-inverted,#fff);font-weight:600}',
  '.orx-btn.d{border-color:var(--bad);color:var(--bad)}',
  '.orx-btn.s{font-size:11px;padding:2px 7px}',
  '.orx-seg{display:flex;gap:2px;padding:2px;border:1px solid var(--line);border-radius:8px;background:var(--l2);flex-wrap:wrap}',
  '.orx-seg button{font:inherit;font-size:12px;padding:3px 9px;border:0;border-radius:6px;background:transparent;color:var(--ink2);cursor:pointer}',
  '.orx-seg button[aria-selected=true]{background:var(--l1);color:var(--ink);font-weight:600;box-shadow:0 0 0 1px var(--line1)}',
  '.orx-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-bottom:10px}',
  '.orx-card{border:1px solid var(--line);border-radius:9px;padding:9px 11px;background:var(--l1);min-width:0}',
  '.orx-k{font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--ink3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
  '.orx-v{font-size:18px;font-weight:650;font-variant-numeric:tabular-nums;line-height:1.25}',
  '.orx-s{font-size:11px;color:var(--ink3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
  '.orx-h{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--ink3);margin:16px 0 6px;display:flex;gap:8px;align-items:center}',
  '.orx-h .n{font-weight:500;letter-spacing:0;text-transform:none}',
  '.orx-row{display:flex;gap:8px;align-items:center;padding:6px 8px;border:1px solid var(--line1);border-radius:7px;margin-bottom:5px;background:var(--l1)}',
  '.orx-row:hover{background:var(--hov)}',
  '.orx-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px}',
  '.orx-grow{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.orx-pill{font-size:10px;padding:1px 7px;border-radius:999px;border:1px solid currentColor;white-space:nowrap;font-weight:600}',
  '.orx-empty{color:var(--ink3);padding:10px;border:1px dashed var(--line);border-radius:8px;line-height:1.5}',
  '.orx-pre{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:1.45;',
  '  background:var(--l2);border:1px solid var(--line1);border-radius:7px;padding:8px 10px;overflow:auto;max-height:260px;white-space:pre;margin:6px 0}',
  '.orx-in{font:inherit;font-size:12px;width:100%;padding:6px 8px;border-radius:7px;border:1px solid var(--line);',
  '  background:var(--dsw-alias-bg-base,transparent);color:inherit;resize:vertical}',
  '.orx-in:focus{outline:2px solid var(--brand);outline-offset:-1px}',
  '.orx-flex{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
  '.orx-field{display:flex;flex-direction:column;gap:3px;flex:1;min-width:130px}',
  '.orx-lbl{font-size:11px;color:var(--ink2)}',
  '.orx-dot{width:8px;height:8px;border-radius:50%;flex:0 0 auto;display:inline-block}',
  '.orx-note{border:1px solid var(--line);border-left-width:3px;border-radius:8px;padding:9px 11px;margin:0 0 10px;line-height:1.5;background:var(--l1)}',
  '.orx-note.bad{border-left-color:var(--bad)}.orx-note.warn{border-left-color:var(--warn)}.orx-note.ok{border-left-color:var(--ok)}',
  '.orx-chat{display:flex;flex-direction:column;height:100%;min-height:0}',
  '.orx-msgs{flex:1;min-height:0;overflow-y:auto;padding:8px 2px;display:flex;flex-direction:column;gap:8px}',
  '.orx-msg{max-width:88%;border-radius:10px;padding:7px 11px;line-height:1.5;white-space:pre-wrap;word-break:break-word;border:1px solid var(--line1)}',
  '.orx-msg.user{align-self:flex-end;background:var(--l2)}',
  '.orx-msg.assistant{align-self:flex-start;background:var(--l1)}',
  '.orx-msg .who{font-size:10px;color:var(--ink3);margin-bottom:3px;text-transform:uppercase;letter-spacing:.04em}',
  '.orx-compose{display:flex;gap:8px;padding:8px 0 0;border-top:1px solid var(--line1);flex:0 0 auto}',
  '.orx-spin{width:14px;height:14px;border-radius:50%;border:2px solid var(--line);border-top-color:var(--brand);animation:orxspin .7s linear infinite;flex:0 0 auto}',
  '@keyframes orxspin{to{transform:rotate(360deg)}}',
  '.orx-toast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:40;background:var(--dsw-alias-bg-layer-3);color:var(--ink);',
  '  border:1px solid var(--line);border-radius:999px;padding:8px 18px;font-size:13px;box-shadow:var(--dsw-shadow-lv2)}',
].join('\n')

function ensureStyles() {
  if (typeof document === 'undefined' || document.getElementById(PLUGIN_ID + '-styles')) return
  const holder = document.createElement('div')
  holder.id = PLUGIN_ID + '-styles'
  holder.style.display = 'none'
  holder.innerHTML = '<style>' + CSS + '</style>'
  document.head.appendChild(holder)
}

// ── api helpers ─────────────────────────────────────────────────────────────

function getJson(url) {
  return fetch(url, { credentials: 'same-origin', headers: { accept: 'application/json' } }).then((r) => {
    if (!r.ok) throw new Error('HTTP ' + r.status)
    return r.json()
  })
}

function mutate(method, url, body) {
  return fetch(url, {
    method,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', accept: 'application/json', 'x-requested-with': PLUGIN_ID },
    body: JSON.stringify(body || {}),
  }).then((r) => r.json().catch(() => ({})).then((d) => {
    if (!r.ok) throw new Error((d && d.error) || 'HTTP ' + r.status)
    return d
  }))
}

function num(v, fallback) { const n = Number(v); return Number.isFinite(n) ? n : fallback }
function ago(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '-'
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 90) return s + 's ago'
  if (s < 5400) return Math.round(s / 60) + 'm ago'
  if (s < 172800) return Math.round(s / 3600) + 'h ago'
  return Math.round(s / 86400) + 'd ago'
}
function shortId(id) {
  const s = String(id || '')
  return s.length > 22 ? s.slice(0, 14) + '…' + s.slice(-4) : s
}

// ── the poll hook ───────────────────────────────────────────────────────────

// Module-level live-activity count, updated by every poll; the tab badge
// callback reads it (the badge fires on tab-bar renders, outside React).
let liveActivityCount = null

function useOrch(visible) {
  const [state, setState] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const j = await getJson(API + '/status')
      if (!alive.current) return
      setState(j)
      setError('')
      if (j && j.agents && j.tasks) {
        const running = (j.agents.running || 0) + ((j.tasks.byStatus && j.tasks.byStatus.running) || 0)
        liveActivityCount = running > 0 ? running : null
      }
    } catch (e) {
      if (alive.current) setError(String(e && e.message || e))
    } finally {
      if (alive.current) setBusy(false)
    }
  }, [])

  useEffect(() => {
    if (!visible) return undefined
    void load()
    const t = setInterval(() => { void load() }, POLL_MS)
    return () => clearInterval(t)
  }, [visible, load, tick])

  return { state, error, busy, reload: () => setTick((v) => v + 1), load }
}

// ── agents view ─────────────────────────────────────────────────────────────

function statusColor(row) {
  if (row.running) return 'var(--brand)'
  if (row.live) return 'var(--ok)'
  return 'var(--ink3)'
}

function AgentsView({ state, rows, scopeLabel, onOpen, onReload }) {
  const [q, setQ] = useState('')
  const [spawnOpen, setSpawnOpen] = useState(false)
  const [busy, setBusy] = useState('')
  const [toast, setToast] = useState('')
  const baseRows = rows || (state && state.agents && state.agents.rows) || []
  const rowsIn = useMemo(() => {
    let list = baseRows
    if (!q.trim()) return list
    const n = q.trim().toLowerCase()
    return list.filter((r) => (r.title || '').toLowerCase().includes(n) || (r.sessionId || '').toLowerCase().includes(n))
  }, [baseRows, q])

  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2600) }

  const quickPrompt = async (row) => {
    const text = window.prompt('Message to ' + (row.title || shortId(row.sessionId)) + ':')
    if (!text || !text.trim()) return
    setBusy(row.sessionId)
    try {
      await mutate('POST', API + '/agents/' + encodeURIComponent(row.sessionId) + '/prompt', { message: text })
      flash('message queued')
      onReload()
    } catch (e) { flash('failed: ' + String(e && e.message || e)) } finally { setBusy('') }
  }

  const cancelAgent = async (row) => {
    setBusy(row.sessionId)
    try {
      await mutate('POST', API + '/agents/' + encodeURIComponent(row.sessionId) + '/cancel', {})
      flash('cancel requested')
      onReload()
    } catch (e) { flash('failed: ' + String(e && e.message || e)) } finally { setBusy('') }
  }

  return React.createElement('div', null,
    React.createElement('div', { className: 'orx-flex', style: { marginBottom: 8 } },
      scopeLabel ? React.createElement('span', { className: 'orx-pill', style: { color: 'var(--brand)' } }, scopeLabel) : null,
      React.createElement('input', {
        className: 'orx-in', placeholder: 'filter by title or id…', value: q,
        onChange: (e) => setQ(e.target.value), style: { maxWidth: 260 },
      }),
      React.createElement('span', { style: { flex: 1 } }),
      React.createElement('button', { className: 'orx-btn', onClick: onReload }, 'refresh'),
      React.createElement('button', { className: 'orx-btn p', onClick: () => setSpawnOpen((v) => !v) }, spawnOpen ? 'close' : '+ new agent')),
    spawnOpen && React.createElement(SpawnForm, { onDone: () => { setSpawnOpen(false); onReload(); }, flash }),
    React.createElement('div', null,
      rowsIn.length === 0
        ? React.createElement('div', { className: 'orx-empty' }, scopeLabel
            ? 'Nothing in this chat scope yet, spawned subagents and forked conversations appear here.'
            : 'No chats match. Spawn one, or check the filter.')
        : rowsIn.map((row) => React.createElement('div', { className: 'orx-row', key: row.sessionId },
            React.createElement('span', { className: 'orx-dot', style: { background: statusColor(row) } }),
            React.createElement('span', {
              className: 'orx-grow', style: { cursor: 'pointer' },
              onClick: () => onOpen(row.sessionId),
              title: row.sessionId,
            },
              React.createElement('b', null, row.title || '(untitled)'),
              React.createElement('span', { className: 'orx-s', style: { marginLeft: 8 } }, shortId(row.sessionId))),
            row.origin === 'subagent' && React.createElement('span', { className: 'orx-pill', style: { color: 'var(--ink3)' } }, 'subagent'),
            row.running
              ? React.createElement('span', { className: 'orx-pill', style: { color: 'var(--brand)' } }, 'working')
              : row.live
                ? React.createElement('span', { className: 'orx-pill', style: { color: 'var(--ok)' } }, 'live')
                : React.createElement('span', { className: 'orx-pill', style: { color: 'var(--ink3)' } }, 'cold'),
            React.createElement('span', { className: 'orx-s' }, ago(row.updatedAt)),
            busy === row.sessionId
              ? React.createElement('span', { className: 'orx-spin' })
              : React.createElement('span', { className: 'orx-flex', style: { gap: 4 } },
                  React.createElement('button', { className: 'orx-btn s', onClick: () => onOpen(row.sessionId) }, 'chat'),
                  React.createElement('button', { className: 'orx-btn s', onClick: () => quickPrompt(row) }, 'prompt'),
                  React.createElement('button', { className: 'orx-btn s d', onClick: () => cancelAgent(row), disabled: !row.live }, 'stop'))))),
    toast && React.createElement('div', { className: 'orx-toast' }, toast))
}

function SpawnForm({ onDone, flash }) {
  const [title, setTitle] = useState('')
  const [prompt, setPrompt] = useState('')
  const [count, setCount] = useState(1)
  const [preset, setPreset] = useState('')
  const [cwd, setCwd] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    try {
      const r = await mutate('POST', API + '/agents/spawn', { title, prompt, count, preset, cwd })
      flash('spawned ' + ((r && r.created) || []).length + ' chat(s)')
      onDone()
    } catch (e) { flash('failed: ' + String(e && e.message || e)) } finally { setBusy(false) }
  }

  return React.createElement('div', { className: 'orx-note', style: { marginBottom: 10 } },
    React.createElement('div', { className: 'orx-k', style: { marginBottom: 6 } }, 'Spawn new agent chat(s)'),
    React.createElement('div', { className: 'orx-flex', style: { marginBottom: 6 } },
      React.createElement('div', { className: 'orx-field' },
        React.createElement('label', { className: 'orx-lbl' }, 'title (addressable by name)'),
        React.createElement('input', { className: 'orx-in', value: title, onChange: (e) => setTitle(e.target.value), placeholder: 'e.g. research-{i}' })),
      React.createElement('div', { className: 'orx-field', style: { maxWidth: 80, flex: 'none' } },
        React.createElement('label', { className: 'orx-lbl' }, 'count'),
        React.createElement('input', { className: 'orx-in', type: 'number', min: 1, max: 8, value: count, onChange: (e) => setCount(num(e.target.value, 1)) }))),
    React.createElement('div', { className: 'orx-flex', style: { marginBottom: 6 } },
      React.createElement('div', { className: 'orx-field', style: { maxWidth: 140, flex: 'none' } },
        React.createElement('label', { className: 'orx-lbl' }, 'preset (optional)'),
        React.createElement('input', { className: 'orx-in', value: preset, onChange: (e) => setPreset(e.target.value), placeholder: 'default' })),
      React.createElement('div', { className: 'orx-field', style: { maxWidth: 220, flex: 'none' } },
        React.createElement('label', { className: 'orx-lbl' }, 'cwd (optional)'),
        React.createElement('input', { className: 'orx-in', value: cwd, onChange: (e) => setCwd(e.target.value), placeholder: 'server default' }))),
    React.createElement('textarea', {
      className: 'orx-in', rows: 3, value: prompt, style: { marginBottom: 6 },
      onChange: (e) => setPrompt(e.target.value),
      placeholder: 'first message - use {i} for fan-out numbering',
    }),
    React.createElement('div', { className: 'orx-flex' },
      React.createElement('button', { className: 'orx-btn p', disabled: busy || !prompt.trim(), onClick: submit }, busy ? 'spawning…' : 'spawn + prompt'),
      React.createElement('button', {
        className: 'orx-btn', disabled: busy || (!prompt.trim() && !title.trim()),
        onClick: () => { void submit() },
      }, 'spawn only (no prompt)'),
      React.createElement('span', { style: { flex: 1 } }),
      React.createElement('span', { className: 'orx-s' }, '{i} becomes 1..N when count > 1')))
}

// ── chat drawer (chat-style interaction) ────────────────────────────────────

function AgentChat({ sessionId, onBack, onReload }) {
  const [data, setData] = useState(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const msgsRef = useRef(null)

  const load = useCallback(async () => {
    try {
      const [st, tr] = await Promise.all([
        getJson(API + '/agents/' + encodeURIComponent(sessionId)),
        getJson(API + '/agents/' + encodeURIComponent(sessionId) + '/transcript'),
      ])
      setData({ status: st.status, transcript: tr })
      setError('')
    } catch (e) { setError(String(e && e.message || e)) }
  }, [sessionId])

  useEffect(() => {
    void load()
    const t = setInterval(() => { void load() }, POLL_MS)
    return () => clearInterval(t)
  }, [load])

  useEffect(() => {
    if (msgsRef.current) msgsRef.current.scrollTop = msgsRef.current.scrollHeight
  }, [data])

  const send = async () => {
    const message = text.trim()
    if (!message) return
    setSending(true)
    try {
      await mutate('POST', API + '/agents/' + encodeURIComponent(sessionId) + '/prompt', { message })
      setText('')
      void load()
    } catch (e) { setError(String(e && e.message || e)) } finally { setSending(false) }
  }

  const cancel = async () => {
    setBusy(true)
    try {
      await mutate('POST', API + '/agents/' + encodeURIComponent(sessionId) + '/cancel', {})
      void load()
    } catch (e) { setError(String(e && e.message || e)) } finally { setBusy(false) }
  }

  const fork = async () => {
    const prompt = window.prompt('First message for the fork (optional):') || ''
    setBusy(true)
    try {
      const r = await mutate('POST', API + '/agents/fork', { agent: sessionId, prompt })
      if (r && r.sessionId) onBack(r.sessionId)
    } catch (e) { setError(String(e && e.message || e)) } finally { setBusy(false) }
  }

  const st = data && data.status
  const messages = (data && data.transcript && data.transcript.messages) || []

  return React.createElement('div', { className: 'orx-chat' },
    React.createElement('div', { className: 'orx-bar' },
      React.createElement('button', { className: 'orx-btn s', onClick: () => onBack(null) }, '← back'),
      React.createElement('span', { className: 'orx-dot', style: { background: st ? statusColor({ running: st.running, live: st.live }) : 'var(--ink3)' } }),
      React.createElement('span', { className: 'orx-grow', title: sessionId },
        React.createElement('b', null, (st && st.title) || shortId(sessionId))),
      st && st.running && React.createElement('span', { className: 'orx-pill', style: { color: 'var(--brand)' } }, 'working'),
      React.createElement('span', { style: { flex: 1 } }),
      React.createElement('button', { className: 'orx-btn s', onClick: fork, disabled: busy }, 'fork'),
      React.createElement('button', { className: 'orx-btn s d', onClick: cancel, disabled: busy || !st || !st.live }, 'stop'),
      React.createElement('button', { className: 'orx-btn s', onClick: () => { void load(); onReload(); } }, 'refresh')),
    error && React.createElement('div', { className: 'orx-note bad', style: { margin: 8 } }, error),
    React.createElement('div', { className: 'orx-msgs', ref: msgsRef },
      messages.length === 0
        ? React.createElement('div', { className: 'orx-empty' }, 'No messages yet - say something below.')
        : messages.map((m, i) => React.createElement('div', { key: i, className: 'orx-msg ' + m.role },
            React.createElement('div', { className: 'who' }, m.role === 'user' ? 'you → agent' : 'agent'),
            String(m.text || '').slice(0, 8000))),
      st && st.running && React.createElement('div', { className: 'orx-flex', style: { padding: 6 } },
        React.createElement('span', { className: 'orx-spin' }),
        React.createElement('span', { className: 'orx-s' }, 'agent is working…'))),
    React.createElement('div', { className: 'orx-compose' },
      React.createElement('textarea', {
        className: 'orx-in', rows: 2, value: text,
        onChange: (e) => setText(e.target.value),
        onKeyDown: (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send() } },
        placeholder: 'message (⌘/Ctrl+Enter to send)',
      }),
      React.createElement('button', { className: 'orx-btn p', disabled: sending || !text.trim(), onClick: send }, sending ? '…' : 'send')))
}


// ── tasks view ──────────────────────────────────────────────────────────────

const TYPE_TABS = ['command', 'scrape', 'http', 'agent']
const STATUS_COLOR = {
  queued: 'var(--ink3)', running: 'var(--brand)', completed: 'var(--ok)',
  failed: 'var(--bad)', cancelled: 'var(--warn)', interrupted: 'var(--warn)',
}

function TasksView({ state, rows, scopeLabel, ownerSession, onReload }) {
  const [typeFilter, setTypeFilter] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [detail, setDetail] = useState(null)
  const [busy, setBusy] = useState('')
  const [toast, setToast] = useState('')
  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2600) }

  const rowsIn = useMemo(() => {
    const list = rows || (state && state.tasks && state.tasks.rows) || []
    return typeFilter ? list.filter((t) => t.type === typeFilter) : list
  }, [rows, state, typeFilter])

  const cancel = async (t) => {
    setBusy(t.id)
    try {
      await mutate('POST', API + '/tasks/' + encodeURIComponent(t.id) + '/cancel', {})
      flash('cancelled ' + t.id)
      onReload()
    } catch (e) { flash('failed: ' + String(e && e.message || e)) } finally { setBusy('') }
  }

  return React.createElement('div', null,
    React.createElement('div', { className: 'orx-flex', style: { marginBottom: 8 } },
      scopeLabel ? React.createElement('span', { className: 'orx-pill', style: { color: 'var(--brand)' } }, scopeLabel) : null,
      React.createElement('div', { className: 'orx-seg' },
        ['', ...TYPE_TABS].map((tp) => React.createElement('button', {
          key: tp || 'all', 'aria-selected': typeFilter === tp,
          onClick: () => setTypeFilter(tp),
        }, tp || 'all'))),
      React.createElement('span', { style: { flex: 1 } }),
      React.createElement('button', { className: 'orx-btn', onClick: onReload }, 'refresh'),
      React.createElement('button', { className: 'orx-btn p', onClick: () => setFormOpen((v) => !v) }, formOpen ? 'close' : '+ new task')),
    formOpen && React.createElement(NewTaskForm, {
      runners: (state && state.runners) || [],
      ownerSession,
      onDone: () => { setFormOpen(false); onReload() },
      flash,
    }),
    rowsIn.length === 0
      ? React.createElement('div', { className: 'orx-empty' }, scopeLabel
          ? 'No tasks from this chat yet. Tasks you create here (and agent tasks driving this chat) appear in this view.'
          : 'No tasks yet. Create one above: a command on any runner, a deterministic scrape, an endpoint call, or a full agent task.')
      : rowsIn.map((t) => React.createElement(TaskRow, {
          key: t.id, t, detail: detail === t.id, busy: busy === t.id,
          onToggle: () => setDetail((v) => (v === t.id ? null : t.id)),
          onCancel: () => cancel(t),
        })),
    toast && React.createElement('div', { className: 'orx-toast' }, toast))
}

function TaskRow({ t, detail, busy, onToggle, onCancel }) {
  return React.createElement('div', null,
    React.createElement('div', { className: 'orx-row', style: { cursor: 'pointer' }, onClick: onToggle },
      React.createElement('span', { className: 'orx-dot', style: { background: STATUS_COLOR[t.status] || 'var(--ink3)' } }),
      React.createElement('span', { className: 'orx-grow' },
        React.createElement('span', { className: 'orx-mono' }, t.id),
        React.createElement('span', { className: 'orx-s', style: { marginLeft: 8 } }, t.title)),
      React.createElement('span', { className: 'orx-pill', style: { color: 'var(--ink3)' } }, t.type),
      t.runner && React.createElement('span', { className: 'orx-s' }, '@' + t.runner),
      t.status === 'running' || t.status === 'queued'
        ? (busy ? React.createElement('span', { className: 'orx-spin' }) : null)
        : React.createElement('span', { className: 'orx-s' }, ago(t.finishedAt || t.createdAt)),
      React.createElement('span', { className: 'orx-s', style: { maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis' } }, t.detail || ''),
      (t.status === 'running' || t.status === 'queued') && React.createElement('button', {
        className: 'orx-btn s d', onClick: (e) => { e.stopPropagation(); onCancel() },
      }, 'stop'),
      React.createElement('button', { className: 'orx-btn s', onClick: (e) => { e.stopPropagation(); onToggle() } }, detail ? 'hide' : 'view')),
    detail && React.createElement(TaskDetail, { t }))
}

function TaskDetail({ t }) {
  const [out, setOut] = useState(null)
  useEffect(() => {
    let alive = true
    const load = () => getJson(API + '/tasks/' + encodeURIComponent(t.id) + '/output?tail=8000')
      .then((j) => { if (alive) setOut(j) })
      .catch(() => { if (alive) setOut(null) })
    void load()
    const timer = t.status === 'running' ? setInterval(load, POLL_MS) : null
    return () => { alive = false; if (timer) clearInterval(timer) }
  }, [t.id, t.status])
  return React.createElement('div', { style: { margin: '0 0 8px 6px', padding: '6px 10px', borderLeft: '2px solid var(--line1)' } },
    React.createElement('div', { className: 'orx-flex', style: { gap: 14 } },
      React.createElement('span', { className: 'orx-s' }, 'status: ' + t.status),
      t.agentSessionId && React.createElement('span', { className: 'orx-s' }, 'chat: ' + shortId(t.agentSessionId)),
      t.via && React.createElement('span', { className: 'orx-s' }, 'via: ' + t.via),
      React.createElement('span', { className: 'orx-s' }, 'created: ' + ago(t.createdAt)),
      t.finishedAt && React.createElement('span', { className: 'orx-s' }, 'finished: ' + ago(t.finishedAt))),
    React.createElement('pre', { className: 'orx-pre' },
      (out && out.output) || t.outputPreview || '(no output yet)'))
}

function NewTaskForm({ runners, ownerSession, onDone, flash }) {
  const [type, setType] = useState('command')
  const [title, setTitle] = useState('')
  const [runner, setRunner] = useState('')
  const [command, setCommand] = useState('')
  const [cwd, setCwd] = useState('')
  const [urls, setUrls] = useState('')
  const [extract, setExtract] = useState('text')
  const [selector, setSelector] = useState('')
  const [pattern, setPattern] = useState('')
  const [url, setUrl] = useState('')
  const [method, setMethod] = useState('GET')
  const [body, setBody] = useState('')
  const [prompt, setPrompt] = useState('')
  const [count, setCount] = useState(1)
  const [forkOf, setForkOf] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const spec = { type, title, runner: runner || 'auto' }
    if (ownerSession) spec.ownerSession = ownerSession
    if (type === 'command') { spec.command = command; spec.cwd = cwd }
    if (type === 'scrape') {
      spec.urls = urls.split(/[\n,]/).map((s) => s.trim()).filter(Boolean)
      spec.extract = extract
      if (selector) spec.selector = selector
      if (pattern) spec.pattern = pattern
    }
    if (type === 'http') { spec.url = url; spec.method = method; if (body) spec.body = body }
    if (type === 'agent') {
      spec.prompt = prompt
      if (count > 1) spec.count = count
      if (forkOf.trim()) spec.forkOf = forkOf.trim()
    }
    setBusy(true)
    try {
      const r = await mutate('POST', API + '/tasks', spec)
      flash('task ' + ((r && r.task && r.task.id) || '?') + ' ' + ((r && r.task && r.task.status) || ''))
      onDone()
    } catch (e) { flash('failed: ' + String(e && e.message || e)) } finally { setBusy(false) }
  }

  const canSubmit = (() => {
    if (type === 'command') return command.trim()
    if (type === 'scrape') return urls.trim()
    if (type === 'http') return url.trim()
    if (type === 'agent') return prompt.trim()
    return false
  })()

  return React.createElement('div', { className: 'orx-note', style: { marginBottom: 10 } },
    React.createElement('div', { className: 'orx-seg', style: { marginBottom: 8 } },
      TYPE_TABS.map((tp) => React.createElement('button', {
        key: tp, 'aria-selected': type === tp, onClick: () => setType(tp),
      }, tp))),
    React.createElement('div', { className: 'orx-flex', style: { marginBottom: 6 } },
      React.createElement('div', { className: 'orx-field' },
        React.createElement('label', { className: 'orx-lbl' }, 'title (optional)'),
        React.createElement('input', { className: 'orx-in', value: title, onChange: (e) => setTitle(e.target.value) }))),
    type === 'command' && React.createElement('div', null,
      React.createElement('textarea', {
        className: 'orx-in', rows: 2, value: command, style: { marginBottom: 6 },
        onChange: (e) => setCommand(e.target.value), placeholder: 'the shell command (runs on the selected runner)',
      }),
      React.createElement('div', { className: 'orx-flex', style: { marginBottom: 6 } },
        React.createElement('div', { className: 'orx-field', style: { maxWidth: 200, flex: 'none' } },
          React.createElement('label', { className: 'orx-lbl' }, 'runner'),
          React.createElement('select', {
            className: 'orx-in', value: runner, onChange: (e) => setRunner(e.target.value),
          }, [React.createElement('option', { key: 'auto', value: '' }, 'auto (default)')]
            .concat((runners || []).map((r) => React.createElement('option', { key: r.id, value: r.id }, r.id + ' (' + r.kind + ')' + (r.enabled ? '' : ' off')))))),
        React.createElement('div', { className: 'orx-field', style: { maxWidth: 220 } },
          React.createElement('label', { className: 'orx-lbl' }, 'cwd (local runner only)'),
          React.createElement('input', { className: 'orx-in', value: cwd, onChange: (e) => setCwd(e.target.value), placeholder: '/' })))),
    type === 'scrape' && React.createElement('div', null,
      React.createElement('textarea', {
        className: 'orx-in', rows: 2, value: urls, style: { marginBottom: 6 },
        onChange: (e) => setUrls(e.target.value), placeholder: 'one url per line (or comma-separated)',
      }),
      React.createElement('div', { className: 'orx-flex', style: { marginBottom: 6 } },
        React.createElement('div', { className: 'orx-field', style: { maxWidth: 110, flex: 'none' } },
          React.createElement('label', { className: 'orx-lbl' }, 'extract'),
          React.createElement('select', { className: 'orx-in', value: extract, onChange: (e) => setExtract(e.target.value) },
            ['text', 'html', 'json'].map((x) => React.createElement('option', { key: x, value: x }, x)))),
        React.createElement('div', { className: 'orx-field', style: { maxWidth: 160 } },
          React.createElement('label', { className: 'orx-lbl' }, 'selector (optional)'),
          React.createElement('input', { className: 'orx-in', value: selector, onChange: (e) => setSelector(e.target.value), placeholder: 'h1, .price, #main' })),
        React.createElement('div', { className: 'orx-field', style: { maxWidth: 200 } },
          React.createElement('label', { className: 'orx-lbl' }, 'regex (optional)'),
          React.createElement('input', { className: 'orx-in', value: pattern, onChange: (e) => setPattern(e.target.value), placeholder: '€([0-9.,]+)' })))),
    type === 'http' && React.createElement('div', null,
      React.createElement('div', { className: 'orx-flex', style: { marginBottom: 6 } },
        React.createElement('div', { className: 'orx-field', style: { maxWidth: 90, flex: 'none' } },
          React.createElement('label', { className: 'orx-lbl' }, 'method'),
          React.createElement('select', { className: 'orx-in', value: method, onChange: (e) => setMethod(e.target.value) },
            ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].map((x) => React.createElement('option', { key: x, value: x }, x)))),
        React.createElement('div', { className: 'orx-field' },
          React.createElement('label', { className: 'orx-lbl' }, 'url'),
          React.createElement('input', { className: 'orx-in', value: url, onChange: (e) => setUrl(e.target.value), placeholder: 'https://…' }))),
      method !== 'GET' && method !== 'HEAD' && React.createElement('textarea', {
        className: 'orx-in', rows: 2, value: body, style: { marginBottom: 6 },
        onChange: (e) => setBody(e.target.value), placeholder: 'request body (json)',
      })),
    type === 'agent' && React.createElement('div', null,
      React.createElement('textarea', {
        className: 'orx-in', rows: 3, value: prompt, style: { marginBottom: 6 },
        onChange: (e) => setPrompt(e.target.value), placeholder: 'what the agent should do (use {i} for fan-out)',
      }),
      React.createElement('div', { className: 'orx-flex', style: { marginBottom: 6 } },
        React.createElement('div', { className: 'orx-field', style: { maxWidth: 90, flex: 'none' } },
          React.createElement('label', { className: 'orx-lbl' }, 'count'),
          React.createElement('input', { className: 'orx-in', type: 'number', min: 1, max: 8, value: count, onChange: (e) => setCount(num(e.target.value, 1)) })),
        React.createElement('div', { className: 'orx-field' },
          React.createElement('label', { className: 'orx-lbl' }, 'fork from (optional: split an existing chat)'),
          React.createElement('input', { className: 'orx-in', value: forkOf, onChange: (e) => setForkOf(e.target.value), placeholder: 'session id / prefix / title' })))),
    React.createElement('div', { className: 'orx-flex' },
      React.createElement('button', { className: 'orx-btn p', disabled: busy || !canSubmit, onClick: submit }, busy ? 'creating…' : 'create task')))
}


// ── runners + providers + api views ─────────────────────────────────────────

function RunnersView({ runners, scopeLabel, onReload }) {
  const [allRows, setAllRows] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    try {
      const j = await getJson(API + '/runners')
      setAllRows(j.rows || [])
      setError('')
    } catch (e) { setError(String(e && e.message || e)) }
  }, [])

  useEffect(() => { void load() }, [load])

  // scoped mode: only the runners this chat's tasks actually used
  const rows = runners || allRows

  const probe = async (id) => {
    setBusy(id)
    try { await mutate('POST', API + '/runners/probe', { runner: id }) } catch { /* surfaced by reload */ }
    await load()
    setBusy('')
  }

  return React.createElement('div', null,
    React.createElement('div', { className: 'orx-flex', style: { marginBottom: 8 } },
      scopeLabel ? React.createElement('span', { className: 'orx-pill', style: { color: 'var(--brand)' } }, scopeLabel) : null,
      React.createElement('span', { className: 'orx-s' }, runners
        ? 'Runners used by this chat\u2019s tasks.'
        : 'Where command tasks execute. Declared in Settings → Orchestrator → runners.'),
      React.createElement('span', { style: { flex: 1 } }),
      React.createElement('button', { className: 'orx-btn', onClick: onReload }, 'refresh')),
    error && React.createElement('div', { className: 'orx-note bad' }, error),
    !rows
      ? React.createElement('div', { className: 'orx-empty' }, 'loading…')
      : rows.length === 0
        ? React.createElement('div', { className: 'orx-empty' }, 'No runners used by this chat yet, run a task from this chat and they appear here.')
      : rows.map((r) => React.createElement('div', { className: 'orx-row', key: r.id },
          React.createElement('span', { className: 'orx-dot', style: { background: r.probe ? (r.probe.ok ? 'var(--ok)' : 'var(--bad)') : 'var(--ink3)' } }),
          React.createElement('span', { className: 'orx-grow' },
            React.createElement('b', null, r.id),
            React.createElement('span', { className: 'orx-s', style: { marginLeft: 8 } }, r.label || '')),
          React.createElement('span', { className: 'orx-pill', style: { color: 'var(--ink3)' } }, r.kind),
          r.enabled ? null : React.createElement('span', { className: 'orx-pill', style: { color: 'var(--warn)' } }, 'off'),
          r.probe && React.createElement('span', { className: 'orx-s' }, r.probe.ok ? ('ok · ' + r.probe.ms + 'ms') : (r.probe.detail || '').slice(0, 60)),
          busy === r.id ? React.createElement('span', { className: 'orx-spin' }) : React.createElement('button', { className: 'orx-btn s', onClick: () => probe(r.id) }, 'probe'))))
}

function ProvidersView({ onReload }) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(async (refresh) => {
    try {
      const j = await getJson(API + '/providers' + (refresh ? '?refresh=1' : ''))
      setRows(j.rows || [])
      setError('')
    } catch (e) { setError(String(e && e.message || e)) }
  }, [])

  useEffect(() => { void load() }, [load])

  return React.createElement('div', null,
    React.createElement('div', { className: 'orx-flex', style: { marginBottom: 8 } },
      React.createElement('span', { className: 'orx-s' }, 'External integrations. Declared in Settings → Orchestrator → providers.'),
      React.createElement('span', { style: { flex: 1 } }),
      React.createElement('button', { className: 'orx-btn', onClick: () => load(true) }, 'refresh'),
      React.createElement('button', { className: 'orx-btn', onClick: onReload }, 'reload status')),
    error && React.createElement('div', { className: 'orx-note bad' }, error),
    !rows
      ? React.createElement('div', { className: 'orx-empty' }, 'loading…')
      : rows.length === 0
        ? React.createElement('div', { className: 'orx-empty' },
            'No providers configured. Add one in Settings → Orchestrator: kind hpc points at an HPC allocation status route (contract in the README), kind http at any JSON status endpoint.')
        : rows.map((p) => React.createElement('div', { key: p.id, style: { marginBottom: 8 } },
            React.createElement('div', { className: 'orx-row' },
              React.createElement('span', { className: 'orx-dot', style: { background: p.ok ? 'var(--ok)' : 'var(--bad)' } }),
              React.createElement('span', { className: 'orx-grow' },
                React.createElement('b', null, p.label || p.id),
                p.kind === 'hpc' && React.createElement('span', { className: 'orx-s', style: { marginLeft: 8 } }, 'HPC allocation')),
              React.createElement('span', { className: 'orx-pill', style: { color: p.ok ? 'var(--ok)' : 'var(--bad)' } }, p.ok ? 'up' : 'down'),
              React.createElement('span', { className: 'orx-s' }, p.detail || '')),
            p.kind === 'hpc' && p.ok && React.createElement('div', { className: 'orx-det', style: { margin: '2px 0 8px 20px', padding: '6px 10px', borderLeft: '2px solid var(--line1)' } },
              p.headline && React.createElement('div', { className: 'orx-s', style: { marginBottom: 4 } }, p.headline),
              p.queue && React.createElement('div', { className: 'orx-s' }, 'queue: ' + p.queue.running + ' running · ' + p.queue.pending + ' pending'),
              p.collector && React.createElement('div', { className: 'orx-s' }, 'collector: ' + String(p.collector.status))),
            p.kind === 'http' && p.ok && p.fields && React.createElement('div', { className: 'orx-det', style: { margin: '2px 0 8px 20px', padding: '6px 10px', borderLeft: '2px solid var(--line1)' } },
              Object.entries(p.fields).slice(0, 8).map(([k, v]) => React.createElement('div', { key: k, className: 'orx-s' }, k + ': ' + String(v)))))))
}

function ApiView() {
  const [secretDraft, setSecretDraft] = useState('')
  const [info, setInfo] = useState(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')
  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2600) }

  const load = useCallback(async () => {
    try { setInfo(await getJson(API + '/settings')) } catch { /* surfaced inline */ }
  }, [])
  useEffect(() => { void load() }, [load])

  const setSecret = async (clear) => {
    setBusy(true)
    try {
      await mutate('POST', API + '/secret', clear ? { clear: true } : { secret: secretDraft.trim() })
      flash(clear ? 'secret cleared' : 'secret saved')
      setSecretDraft('')
      await load()
    } catch (e) { flash('failed: ' + String(e && e.message || e)) } finally { setBusy(false) }
  }

  const NL = String.fromCharCode(10)
  const BS = String.fromCharCode(92)
  const SQ = String.fromCharCode(39)
  const configured = Boolean(info && (info.settings.api.secretConfigured || info.envSecretPresent))
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:3080'
  const curl = ['curl -sS -X POST ' + origin + API + '/remote/prompt ' + BS,
    '  -H "content-type: application/json" ' + BS,
    '  -H "x-orchestrator-secret: $ORCH_SECRET" ' + BS,
    '  -d ' + '{"chat":"<session id or title>","message":"ping"}' + SQ,
  ].join(NL)

  return React.createElement('div', null,
    React.createElement('div', { className: 'orx-h' }, 'machine api'),
    React.createElement('div', { className: 'orx-note' + (configured ? ' ok' : ' warn') },
      configured
        ? 'The machine API is armed (secret configured). Anything that can reach this host and present the secret can prompt chats, spawn agents and run tasks.'
        : 'The machine API fails closed: no secret is configured. Set one below or set the DSH_ORCHESTRATOR_SECRET environment variable on the host.'),
    React.createElement('div', { className: 'orx-flex', style: { margin: '6px 0 12px' } },
      React.createElement('input', {
        className: 'orx-in', type: 'password', value: secretDraft, style: { maxWidth: 320 },
        placeholder: 'at least 16 characters', onChange: (e) => setSecretDraft(e.target.value),
      }),
      React.createElement('button', { className: 'orx-btn p', disabled: busy || secretDraft.trim().length < 16, onClick: () => setSecret(false) }, 'set / rotate'),
      info && info.settings.api.secretConfigured && React.createElement('button', { className: 'orx-btn d', disabled: busy, onClick: () => setSecret(true) }, 'clear')),
    React.createElement('div', { className: 'orx-s', style: { marginBottom: 12 } },
      info && info.settings.api.secretFingerprint ? ('stored secret fingerprint: ' + info.settings.api.secretFingerprint) : '',
      info && info.envSecretPresent ? ' (an env secret is present and wins)' : ''),
    React.createElement('div', { className: 'orx-h' }, 'prompt a chat from anywhere'),
    React.createElement('pre', { className: 'orx-pre' }, curl),
    React.createElement('div', { className: 'orx-h' }, 'tool-server contract'),
    React.createElement('div', { className: 'orx-s', style: { marginBottom: 6 } },
      'Another host can run work HERE by declaring this plugin as an http runner:'),
    React.createElement('pre', { className: 'orx-pre' },
      ['POST ' + origin + API + '/remote/run',
       '{"kind":"command","spec":{"command":"uptime"},"timeoutMs":30000}',
       '-> {"ok":true,"status":"completed","output":"..."}',
       '',
       'kinds: probe | command | scrape | http'].join(NL)),
    toast && React.createElement('div', { className: 'orx-toast' }, toast))
}

// ── the main tab view ───────────────────────────────────────────────────────

const SECTIONS = ['agents', 'tasks', 'runners', 'providers', 'api']

function OrchestratorViewInner({ visible, scope }) {
  // scope: {sessionId, cwd?} from the better-sidebar - null when the tab
  // somehow mounts outside a session (then only the 'all' view is offered).
  const mySession = scope && typeof scope.sessionId === 'string' ? scope.sessionId : null
  const [scopeMode, setScopeMode] = useState('all') // 'all' | 'mine'
  const [section, setSection] = useState('agents')
  const [openChat, setOpenChat] = useState(null)
  const { state, error, busy, reload } = useOrch(visible && !openChat)
  const flashRef = useRef('')

  useEffect(() => { ensureStyles() }, [])

  // 'this chat' agent rows: the current session + its subagent children +
  // its parent (the conversation this chat was forked from, if any).
  const scopedAgentRows = useMemo(() => {
    if (!mySession || !state) return null
    const all = (state.agents && state.agents.rows) || []
    const me = all.find((r) => r.sessionId === mySession)
    const parent = me && me.parentSessionId
    return all.filter((r) =>
      r.sessionId === mySession
      || r.parentSessionId === mySession
      || (parent && r.sessionId === parent)
      || (parent && r.parentSessionId === parent && r.origin === 'subagent'),
    )
  }, [state, mySession])

  const scopedTasks = useMemo(() => {
    if (!mySession || !state) return null
    const all = (state.tasks && state.tasks.rows) || []
    return all.filter((t) => t.ownerSession === mySession || t.agentSessionId === mySession)
  }, [state, mySession])

  const scopedRunners = useMemo(() => {
    if (!scopedTasks) return null
    const used = new Set(scopedTasks.map((t) => t.runner).filter(Boolean))
    return ((state && state.runners) || []).filter((r) => used.has(r.id))
  }, [scopedTasks, state])

  const inScope = scopeMode === 'mine' && mySession

  const badge = useMemo(() => {
    if (!state) return null
    const runningAgents = state.agents ? state.agents.running : 0
    const runningTasks = state.tasks && state.tasks.byStatus ? (state.tasks.byStatus.running || 0) : 0
    const n = runningAgents + runningTasks
    return n > 0 ? n : null
  }, [state])

  if (openChat) {
    return React.createElement('div', { className: 'orx' },
      React.createElement(AgentChat, { sessionId: openChat, onBack: (sid) => setOpenChat(sid || null), onReload: reload }))
  }

  return React.createElement('div', { className: 'orx' },
    React.createElement('div', { className: 'orx-bar' },
      React.createElement('div', { className: 'orx-seg' },
        SECTIONS.map((s) => React.createElement('button', {
          key: s, 'aria-selected': section === s, onClick: () => setSection(s),
        }, s))),
      mySession && (section === 'agents' || section === 'tasks' || section === 'runners')
        ? React.createElement('div', { className: 'orx-seg', title: 'scope the list to this conversation or show everything' },
            React.createElement('button', {
              'aria-selected': !inScope, onClick: () => setScopeMode('all'),
            }, 'all'),
            React.createElement('button', {
              'aria-selected': inScope, onClick: () => setScopeMode('mine'),
            }, 'this chat'))
        : null,
      React.createElement('span', { style: { flex: 1 } }),
      badge ? React.createElement('span', { className: 'orx-pill', style: { color: 'var(--brand)' } }, badge + ' active') : null,
      busy ? React.createElement('span', { className: 'orx-spin' }) : null,
      React.createElement('button', { className: 'orx-btn s', onClick: reload }, 'refresh')),
    error && React.createElement('div', { className: 'orx-note bad', style: { margin: 8 } },
      error + ', is the dsh-orchestrator host half mounted? (the sidebar tab can load before a dsh-web restart brings the route up)'),
    state && state.agents && state.agents.degraded
      ? React.createElement('div', { className: 'orx-note warn', style: { margin: '0 8px 8px' }, title: String(state.agents.degraded.join('; ')) },
          'session catalog partially degraded, showing live agents only; the full list may be incomplete (',
          String(state.agents.degraded[0]).slice(0, 80), ')')
      : null,
    React.createElement('div', { className: 'orx-body' },
      React.createElement('div', { className: 'orx-cards' },
        React.createElement('div', { className: 'orx-card' },
          React.createElement('div', { className: 'orx-k' }, inScope ? 'chats (this chat)' : 'chats'),
          React.createElement('div', { className: 'orx-v' }, String(state ? (inScope && scopedAgentRows ? scopedAgentRows.length : state.agents.total) : '-')),
          React.createElement('div', { className: 'orx-s' }, state ? (state.agents.live + ' live · ' + state.agents.running + ' working') : '')),
        React.createElement('div', { className: 'orx-card' },
          React.createElement('div', { className: 'orx-k' }, inScope ? 'tasks (this chat)' : 'tasks'),
          React.createElement('div', { className: 'orx-v' }, String(state ? (inScope && scopedTasks ? scopedTasks.length : Object.values(state.tasks.byStatus).reduce((a, b) => a + b, 0)) : '-')),
          React.createElement('div', { className: 'orx-s' }, state ? Object.entries(state.tasks.byStatus).map(([k, v]) => v + ' ' + k).join(' · ') : '')),
        React.createElement('div', { className: 'orx-card' },
          React.createElement('div', { className: 'orx-k' }, 'runners'),
          React.createElement('div', { className: 'orx-v' }, String(state ? state.runners.length : '-')),
          React.createElement('div', { className: 'orx-s' }, state ? state.runners.map((r) => r.id).join(' · ') : '')),
        React.createElement('div', { className: 'orx-card' },
          React.createElement('div', { className: 'orx-k' }, 'providers'),
          React.createElement('div', { className: 'orx-v' }, String(state ? state.providers.length : '-')),
          React.createElement('div', { className: 'orx-s' }, state ? (state.providers.length ? state.providers.map((p) => p.id + (p.pending ? '…' : p.ok ? '✓' : '✗')).join(' · ') : 'none') : ''))),
      section === 'agents' && React.createElement(AgentsView, {
        state,
        rows: inScope ? scopedAgentRows : undefined,
        scopeLabel: inScope ? 'this chat' : null,
        onOpen: (sid) => setOpenChat(sid), onReload: reload,
      }),
      section === 'tasks' && React.createElement(TasksView, {
        state,
        rows: inScope ? scopedTasks : undefined,
        scopeLabel: inScope ? 'this chat' : null,
        ownerSession: inScope ? mySession : null,
        onReload: reload,
      }),
      section === 'runners' && React.createElement(RunnersView, {
        runners: inScope ? scopedRunners : undefined,
        scopeLabel: inScope ? 'this chat' : null,
        onReload: reload,
      }),
      section === 'providers' && React.createElement(ProvidersView, { onReload: reload }),
      section === 'api' && React.createElement(ApiView, null)))
}


// ── the Settings-page section ───────────────────────────────────────────────

function SettingsSection() {
  const [data, setData] = useState(null)
  const [form, setForm] = useState(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState('')
  const flash = (m) => { setToast(m); setTimeout(() => setToast(''), 2600) }

  const load = useCallback(async () => {
    try {
      const j = await getJson(API + '/settings')
      setData(j)
      setForm(JSON.parse(JSON.stringify(j.settings)))
    } catch (e) { flash('load failed: ' + String(e && e.message || e)) }
  }, [])
  useEffect(() => { void load() }, [load])

  if (!form) {
    return React.createElement('div', { className: 'orx-empty' }, 'loading settings… (the host half must be mounted for this section to work)')
  }

  const setField = (path, value) => {
    setForm((f) => {
      const next = JSON.parse(JSON.stringify(f))
      let cur = next
      for (let i = 0; i < path.length - 1; i++) cur = cur[path[i]]
      cur[path[path.length - 1]] = value
      return next
    })
  }

  const save = async () => {
    setBusy(true)
    try {
      const patch = {
        enabled: form.enabled,
        mirrorJobs: form.mirrorJobs,
        requireHarnessCookie: form.requireHarnessCookie,
        trustedHosts: form.trustedHosts,
        api: { rateLimitPerMinute: form.api.rateLimitPerMinute },
        agents: {
          catalogMax: form.agents.catalogMax,
          transcriptMax: form.agents.transcriptMax,
          spawnMax: form.agents.spawnMax,
          promptMaxChars: form.agents.promptMaxChars,
          defaultPreset: form.agents.defaultPreset,
          defaultCwd: form.agents.defaultCwd,
        },
        tasks: {
          maxConcurrent: form.tasks.maxConcurrent,
          historyKeep: form.tasks.historyKeep,
          commandTimeoutMs: form.tasks.commandTimeoutMs,
          scrapeTimeoutMs: form.tasks.scrapeTimeoutMs,
          httpTimeoutMs: form.tasks.httpTimeoutMs,
          scrapeMaxUrls: form.tasks.scrapeMaxUrls,
          defaultRunner: form.tasks.defaultRunner,
          allowCommandTasks: form.tasks.allowCommandTasks,
          allowRemoteRunners: form.tasks.allowRemoteRunners,
        },
        runners: form.runners,
        providers: form.providers,
      }
      await mutate('PUT', API + '/settings', patch)
      flash('settings saved')
      await load()
    } catch (e) { flash('save failed: ' + String(e && e.message || e)) } finally { setBusy(false) }
  }

  const row = (label, node) => React.createElement('div', { className: 'orx-flex', style: { marginBottom: 6 } },
    React.createElement('label', { className: 'orx-lbl', style: { width: 210, flex: 'none' } }, label), node)
  const inp = (path, opts) => React.createElement('input', {
    className: 'orx-in', style: { maxWidth: 260 },
    value: String(getField(form, path) ?? ''),
    ...opts,
    onChange: (e) => setField(path, opts && opts.type === 'number' ? num(e.target.value, 0) : e.target.value),
  })
  const tog = (path) => {
    const v = Boolean(getField(form, path))
    return React.createElement('button', {
      className: 'orx-btn' + (v ? ' p' : ''), onClick: () => setField(path, !v),
    }, v ? 'on' : 'off')
  }
  const getField = (obj, path) => path.reduce((acc, k) => (acc == null ? acc : acc[k]), obj)

  const addRunner = () => setField(['runners'], [...(form.runners || []), { id: 'runner-' + ((form.runners || []).length + 1), label: '', kind: 'local', enabled: true }])
  const addProvider = () => setField(['providers'], [...(form.providers || []), { id: 'prov-' + ((form.providers || []).length + 1), label: '', kind: 'http', url: '', enabled: true, pollSeconds: 60 }])

  return React.createElement('div', { className: 'orx', style: { height: 'auto', overflow: 'visible', fontSize: 13 } },
    React.createElement('div', { className: 'orx-note' },
      'Orchestrator: agents, tasks, runners and integrations. Everything here is deployment state - nothing is hardcoded in the plugin. The machine API is protected by the secret below and fails closed without one.'),
    React.createElement('div', { className: 'orx-h' }, 'general'),
    row('plugin enabled', tog(['enabled'])),
    row('mirror tasks into Background Tasks', tog(['mirrorJobs'])),
    row('require harness session cookie on UI mutations', tog(['requireHarnessCookie'])),
    row('trusted hosts (comma-separated)', React.createElement('input', {
      className: 'orx-in', style: { maxWidth: 320 },
      value: (form.trustedHosts || []).join(', '),
      onChange: (e) => setField(['trustedHosts'], e.target.value.split(',').map((s) => s.trim()).filter(Boolean)),
    })),
    row('machine API rate limit (calls/min/IP)', inp(['api', 'rateLimitPerMinute'], { type: 'number' })),
    React.createElement('div', { className: 'orx-h' }, 'agents'),
    row('default preset (empty = deployment default)', inp(['agents', 'defaultPreset'])),
    row('default cwd for new chats (empty = server default)', inp(['agents', 'defaultCwd'])),
    row('spawn fan-out cap', inp(['agents', 'spawnMax'], { type: 'number' })),
    row('catalog rows', inp(['agents', 'catalogMax'], { type: 'number' })),
    row('transcript messages per read', inp(['agents', 'transcriptMax'], { type: 'number' })),
    React.createElement('div', { className: 'orx-h' }, 'tasks'),
    row('max concurrent tasks', inp(['tasks', 'maxConcurrent'], { type: 'number' })),
    row('finished tasks kept', inp(['tasks', 'historyKeep'], { type: 'number' })),
    row('command timeout (ms)', inp(['tasks', 'commandTimeoutMs'], { type: 'number' })),
    row('scrape timeout (ms)', inp(['tasks', 'scrapeTimeoutMs'], { type: 'number' })),
    row('http timeout (ms)', inp(['tasks', 'httpTimeoutMs'], { type: 'number' })),
    row('scrape max urls', inp(['tasks', 'scrapeMaxUrls'], { type: 'number' })),
    row('default runner', inp(['tasks', 'defaultRunner'])),
    row('allow command tasks', tog(['tasks', 'allowCommandTasks'])),
    row('allow remote runners', tog(['tasks', 'allowRemoteRunners'])),
    React.createElement('div', { className: 'orx-h' }, 'runners (where command tasks execute)'),
    (form.runners || []).map((r, i) => React.createElement('div', { key: r.id + ':' + i, className: 'orx-note', style: { marginBottom: 6 } },
      React.createElement('div', { className: 'orx-flex', style: { marginBottom: 4 } },
        inp(['runners', i, 'id'], { style: { maxWidth: 130 } }),
        inp(['runners', i, 'label'], { placeholder: 'label' }),
        React.createElement('select', {
          className: 'orx-in', style: { maxWidth: 90 }, value: r.kind,
          onChange: (e) => setField(['runners', i, 'kind'], e.target.value),
        }, ['local', 'ssh', 'http'].map((k) => React.createElement('option', { key: k, value: k }, k))),
        React.createElement('button', { className: 'orx-btn' + (r.enabled ? ' p' : ''), onClick: () => setField(['runners', i, 'enabled'], !r.enabled) }, r.enabled ? 'on' : 'off'),
        React.createElement('span', { style: { flex: 1 } }),
        React.createElement('button', {
          className: 'orx-btn d', onClick: () => setField(['runners'], form.runners.filter((_, j) => j !== i)),
        }, 'remove')),
      r.kind === 'ssh' && React.createElement('div', { className: 'orx-flex' },
        inp(['runners', i, 'ssh', 'target'], { placeholder: 'ssh target (alias or user@host)', style: { maxWidth: 220 } }),
        inp(['runners', i, 'ssh', 'bin'], { placeholder: 'ssh bin', style: { maxWidth: 80 } })),
      r.kind === 'http' && React.createElement('div', { className: 'orx-flex' },
        inp(['runners', i, 'http', 'url'], { placeholder: 'https://other-host/dsh-orchestrator/api/remote/run', style: { maxWidth: 320 } }),
        inp(['runners', i, 'http', 'secretEnv'], { placeholder: 'env var with bearer token', style: { maxWidth: 160 } })))),
    React.createElement('div', { className: 'orx-flex', style: { marginBottom: 10 } },
      React.createElement('button', { className: 'orx-btn', onClick: addRunner }, '+ add runner')),
    React.createElement('div', { className: 'orx-h' }, 'providers (integrations)'),
    (form.providers || []).map((p, i) => React.createElement('div', { key: p.id + ':' + i, className: 'orx-note', style: { marginBottom: 6 } },
      React.createElement('div', { className: 'orx-flex', style: { marginBottom: 4 } },
        inp(['providers', i, 'id'], { style: { maxWidth: 130 } }),
        inp(['providers', i, 'label'], { placeholder: 'label' }),
        React.createElement('select', {
          className: 'orx-in', style: { maxWidth: 90 }, value: p.kind,
          onChange: (e) => setField(['providers', i, 'kind'], e.target.value),
        }, ['http', 'hpc'].map((k) => React.createElement('option', { key: k, value: k }, k))),
        React.createElement('button', { className: 'orx-btn' + (p.enabled ? ' p' : ''), onClick: () => setField(['providers', i, 'enabled'], !p.enabled) }, p.enabled ? 'on' : 'off'),
        React.createElement('span', { style: { flex: 1 } }),
        React.createElement('button', {
          className: 'orx-btn d', onClick: () => setField(['providers'], form.providers.filter((_, j) => j !== i)),
        }, 'remove')),
      React.createElement('div', { className: 'orx-flex' },
        inp(['providers', i, 'url'], {
          placeholder: p.kind === 'hpc' ? 'http://127.0.0.1:8080/hpc' : 'https://status-endpoint/json',
          style: { maxWidth: 320 },
        }),
        p.kind === 'http' && inp(['providers', i, 'secretEnv'], { placeholder: 'env var with bearer token', style: { maxWidth: 160 } })),
      p.kind === 'hpc' && React.createElement('div', { className: 'orx-s' }, 'reads /health and /state (contract in the README)'))),
    React.createElement('div', { className: 'orx-flex', style: { marginBottom: 10 } },
      React.createElement('button', { className: 'orx-btn', onClick: addProvider }, '+ add provider')),
    React.createElement('div', { className: 'orx-flex' },
      React.createElement('button', { className: 'orx-btn p', disabled: busy, onClick: save }, busy ? 'saving…' : 'save settings'),
      React.createElement('button', { className: 'orx-btn', disabled: busy, onClick: load }, 'revert'),
      React.createElement('span', { className: 'orx-s', style: { alignSelf: 'center' } },
        data && data.settings.api.secretConfigured ? ('machine API: secret configured (' + data.settings.api.secretFingerprint + ')') : 'machine API: no secret (fails closed)')),
    toast && React.createElement('div', { className: 'orx-toast' }, toast))
}

// ── icons ───────────────────────────────────────────────────────────────────

function OrchIcon(size) {
  return React.createElement('svg', {
    width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round', 'aria-hidden': 'true',
  },
    React.createElement('circle', { cx: 3.2, cy: 4.4, r: 1.6 }),
    React.createElement('circle', { cx: 3.2, cy: 11.6, r: 1.6 }),
    React.createElement('circle', { cx: 12.8, cy: 8, r: 1.8 }),
    React.createElement('path', { d: 'M4.6 4.8 11 7.4M4.6 11.2 11 8.6', strokeLinecap: 'round' }))
}

// ── plugin contract ─────────────────────────────────────────────────────────

export const inject = ['betterSidebar', 'slots', 'locale']

export function apply(ctx) {
  if (!ctx.betterSidebar || typeof ctx.betterSidebar.registerTab !== 'function') {
    console.error('[dsh-orchestrator] ctx.betterSidebar.registerTab is unavailable; Orchestrate tab not registered')
  } else {
    ctx.effect(() => ctx.betterSidebar.registerTab({
      id: 'dsh-orchestrator:control',
      title: 'Orchestrate',
      order: 90,
      single: true,
      icon: (size) => OrchIcon(size || 16),
      component: (props) => React.createElement(OrchestratorViewInner, { visible: props.visible, scope: props.scope }),
      badge: () => liveActivityCount,
      settings: {
        pluginToggles: [
          {
            key: 'autoPoll',
            title: 'Poll while visible',
            desc: 'The tab refreshes every few seconds while it is the active tab and the panel is open.',
            type: 'switch',
          },
        ],
      },
    }), 'dsh-orchestrator: register the Orchestrate sidebar tab')
  }

  if (ctx.slots && typeof ctx.slots.inject === 'function') {
    ctx.effect(() => ctx.slots.inject('settings.section', function () {
      return ctx.slots.register({
        name: 'settings.section',
        id: 'dsh-orchestrator',
        order: 96,
        label: function () { return 'Orchestrator' },
        inject: function () { return {} },
      }, function OrchestratorSectionSlot() {
        useEffect(ensureStyles, [])
        return React.createElement(SettingsSection)
      })
    }), 'dsh-orchestrator: settings section')
  } else {
    console.warn('[dsh-orchestrator] ctx.slots unavailable; settings section not registered')
  }
}

// Plugin contract: the OBJECT form only. Do NOT add a default export, the
// client runner takes a default-exported FUNCTION as the plugin itself, which
// has no inject declaration site and loses the service gate (caught live in
// the sandboxed-browser verification: "cannot get property betterSidebar
// without inject").
export const name = 'dsh-orchestrator'

