import { useState } from 'react'
import './App.css'

type ApiKey = { id: string; label: string; role: 'admin' | 'member'; revoked?: boolean; created_at?: string; createdAt?: string }
type AuditEvent = { id?: string; timestamp?: string; created_at?: string; key_id?: string; action?: string; tool_name?: string; outcome?: string; [key: string]: unknown }
type Server = { id?: string; name: string; url?: string; enabled?: boolean; description: string; status: 'Connected' | 'Unreachable' | 'Disabled'; tools: string[] }

const initialServers: Server[] = [
  { name: 'WooCommerce', description: 'Products, orders and store operations', status: 'Connected', tools: ['list_products', 'create_product', 'list_orders', 'get_order', 'update_order_status'] },
  { name: 'Sales Analytics', description: 'Sales summaries and reporting', status: 'Connected', tools: ['get_sales_summary'] },
  { name: 'Inventory', description: 'Stock levels and low-stock alerts', status: 'Connected', tools: ['get_stock', 'get_low_stock_products'] },
]

function App() {
  const [servers, setServers] = useState(initialServers)
  const [activeTab, setActiveTab] = useState('Overview')
  const [apiKey, setApiKey] = useState('')
  const [gatewayUrl, setGatewayUrl] = useState('http://127.0.0.1:3002')
  const [health, setHealth] = useState('Not checked')
  const [busy, setBusy] = useState(false)
  const [keyRows, setKeyRows] = useState<ApiKey[]>([])
  const [newLabel, setNewLabel] = useState('')
  const [newRole, setNewRole] = useState<'admin' | 'member'>('member')
  const [createdKey, setCreatedKey] = useState('')
  const [keyError, setKeyError] = useState('')
  const [auditRows, setAuditRows] = useState<AuditEvent[]>([])
  const [auditError, setAuditError] = useState('')
  const [upstreamError, setUpstreamError] = useState('')
  const [newUpstreamName, setNewUpstreamName] = useState('')
  const [newUpstreamUrl, setNewUpstreamUrl] = useState('')
  const [message, setMessage] = useState('')
  const [chat, setChat] = useState<{ role: string; text: string }[]>([
    { role: 'assistant', text: 'Welcome to Urumi. Enter your Gateway API key under API Keys to test authenticated Gateway requests. Natural-language LLM tool calling is not implemented yet.' },
  ])

  const baseUrl = () => gatewayUrl.trim().replace(/\/+$/, '')
  const authHeaders = () => ({ Authorization: `Bearer ${apiKey.trim()}` })

  async function requestJson(path: string, init: RequestInit = {}) {
    const response = await fetch(`${baseUrl()}${path}`, {
      ...init,
      headers: { ...authHeaders(), ...(init.headers ?? {}) },
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`)
    return data
  }

  async function checkHealth() {
    setHealth('Checking…')
    try {
      const response = await fetch(`${baseUrl()}/health`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      setHealth(`${data.status ?? 'ok'} · ${data.service ?? 'Gateway'}`)
    } catch (error) {
      setHealth(`Unreachable: ${error instanceof Error ? error.message : 'request failed'}`)
    }
  }

  async function loadKeys() {
    setKeyError('')
    setCreatedKey('')
    if (!apiKey.trim()) { setKeyError('Enter an admin API key first.'); return }
    setBusy(true)
    try {
      const data = await requestJson('/admin/api-keys')
      setKeyRows(Array.isArray(data) ? data : data.keys ?? [])
    } catch (error) {
      setKeyError(error instanceof Error ? error.message : 'Could not load API keys')
    } finally { setBusy(false) }
  }

  async function createKey() {
    setKeyError('')
    setCreatedKey('')
    if (!apiKey.trim()) { setKeyError('Enter an admin API key first.'); return }
    if (!newLabel.trim()) { setKeyError('Enter a label for the new key.'); return }
    setBusy(true)
    try {
      const data = await requestJson('/admin/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: newLabel.trim(), role: newRole }),
      })
      setCreatedKey(data.key ?? '')
      setNewLabel('')
      await loadKeys()
      setCreatedKey(data.key ?? '')
    } catch (error) {
      setKeyError(error instanceof Error ? error.message : 'Could not create API key')
    } finally { setBusy(false) }
  }

  async function revokeKey(id: string) {
    if (!window.confirm('Revoke this API key? Any client using it will lose access.')) return
    setKeyError('')
    setBusy(true)
    try {
      await requestJson(`/admin/api-keys/${encodeURIComponent(id)}`, { method: 'DELETE' })
      await loadKeys()
    } catch (error) {
      setKeyError(error instanceof Error ? error.message : 'Could not revoke API key')
    } finally { setBusy(false) }
  }

  async function loadAudit() {
    setAuditError('')
    if (!apiKey.trim()) { setAuditError('Enter an admin API key first.'); return }
    setBusy(true)
    try {
      const data = await requestJson('/admin/audit-logs?limit=100')
      setAuditRows(Array.isArray(data) ? data : data.events ?? data.logs ?? [])
    } catch (error) {
      setAuditError(error instanceof Error ? error.message : 'Could not load audit logs')
    } finally { setBusy(false) }
  }

  async function discoverTools() {
    if (!apiKey.trim()) {
      setChat((items) => [...items, { role: 'assistant', text: 'Enter your Gateway API key in API Keys first.' }])
      return
    }
    setBusy(true)
    try {
      const response = await fetch(`${baseUrl()}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream', ...authHeaders() },
        body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method: 'tools/list', params: {} }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`)
      const tools = data.result?.tools ?? []
      setChat((items) => [...items, { role: 'assistant', text: `Discovered ${tools.length} Gateway tools:\n${tools.map((tool: { name: string; description?: string }) => `• ${tool.name}${tool.description ? ` — ${tool.description}` : ''}`).join('\n') || JSON.stringify(data, null, 2)}` }])
    } catch (error) {
      setChat((items) => [...items, { role: 'assistant', text: `Tool discovery failed: ${error instanceof Error ? error.message : 'request failed'}` }])
    } finally { setBusy(false) }
  }

  async function sendMessage() {
    const text = message.trim()
    if (!text || busy) return
    setChat((items) => [...items, { role: 'user', text }])
    setMessage('')
    setChat((items) => [...items, { role: 'assistant', text: 'The chat interface is ready, but a natural-language LLM provider and tool-calling loop have not been configured. Use “Discover tools” to verify the live MCP tool list.' }])
  }

  async function loadUpstreams() {
    setUpstreamError('')
    if (!apiKey.trim()) { setUpstreamError('Enter an admin API key in API Keys first.'); return }
    setBusy(true)
    try {
      const data = await requestJson('/admin/upstreams')
      const rows = Array.isArray(data) ? data : data.upstreams ?? []
      setServers(rows.map((row: { id: string; name: string; url: string; enabled: boolean }) => {
        const name = String(row.name)
        const key = name.toLowerCase()
        const tools = key.includes('woo')
          ? ['list_products', 'create_product', 'list_orders', 'get_order', 'update_order_status']
          : key.includes('analytic') || key.includes('sales')
            ? ['get_sales_summary']
            : key.includes('invent') || key.includes('stock')
              ? ['get_stock', 'get_low_stock_products']
              : []
        return {
          id: row.id,
          name,
          url: row.url,
          enabled: Boolean(row.enabled),
          description: key.includes('woo') ? 'Products, orders and store operations'
            : key.includes('analytic') || key.includes('sales') ? 'Sales summaries and reporting'
            : key.includes('invent') || key.includes('stock') ? 'Stock levels and low-stock alerts'
            : 'Custom MCP upstream',
          status: row.enabled ? 'Connected' as const : 'Disabled' as const,
          tools,
        }
      }))
    } catch (error) {
      setUpstreamError(error instanceof Error ? error.message : 'Could not load upstreams')
    } finally { setBusy(false) }
  }

  async function toggleServer(server: Server) {
    if (!server.id) {
      setUpstreamError('Refresh upstreams to load persisted server records first.')
      return
    }
    setUpstreamError('')
    setBusy(true)
    try {
      await requestJson(`/admin/upstreams/${encodeURIComponent(server.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !server.enabled }),
      })
      await loadUpstreams()
    } catch (error) {
      setUpstreamError(error instanceof Error ? error.message : 'Could not update upstream')
    } finally { setBusy(false) }
  }

  async function addUpstream() {
    setUpstreamError('')
    if (!newUpstreamName.trim() || !newUpstreamUrl.trim()) {
      setUpstreamError('Enter both an upstream name and its MCP URL.')
      return
    }
    setBusy(true)
    try {
      await requestJson('/admin/upstreams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newUpstreamName.trim(), url: newUpstreamUrl.trim() }),
      })
      setNewUpstreamName('')
      setNewUpstreamUrl('')
      await loadUpstreams()
    } catch (error) {
      setUpstreamError(error instanceof Error ? error.message : 'Could not add upstream')
    } finally { setBusy(false) }
  }

  async function editUpstream(server: Server) {
    if (!server.id) return
    const name = window.prompt('Upstream name:', server.name)
    if (name === null) return
    const url = window.prompt('MCP endpoint URL:', server.url ?? '')
    if (url === null) return
    if (!name.trim() || !url.trim()) {
      setUpstreamError('Name and URL cannot be empty.')
      return
    }
    setUpstreamError('')
    setBusy(true)
    try {
      await requestJson(`/admin/upstreams/${encodeURIComponent(server.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), url: url.trim() }),
      })
      await loadUpstreams()
    } catch (error) {
      setUpstreamError(error instanceof Error ? error.message : 'Could not edit upstream')
    } finally { setBusy(false) }
  }

  async function removeUpstream(server: Server) {
    if (!server.id || !window.confirm(`Remove upstream "${server.name}"? This does not delete its service.`)) return
    setUpstreamError('')
    setBusy(true)
    try {
      await requestJson(`/admin/upstreams/${encodeURIComponent(server.id)}`, { method: 'DELETE' })
      await loadUpstreams()
    } catch (error) {
      setUpstreamError(error instanceof Error ? error.message : 'Could not remove upstream')
    } finally { setBusy(false) }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">U</span><div><strong>urumi</strong><small>TEAM MCP GATEWAY</small></div></div>
        <div className="workspace-label">WORKSPACE</div>
        <nav>{['Overview', 'MCP Servers', 'API Keys', 'Audit Logs', 'Chat Agent', 'Settings'].map((tab) => (
          <button key={tab} className={`nav-item ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)}>
            <span className="nav-dot">{tab === 'Overview' ? '◈' : tab === 'MCP Servers' ? '⌘' : tab === 'API Keys' ? '⚿' : tab === 'Audit Logs' ? '≋' : tab === 'Chat Agent' ? '✳' : '⚙'}</span>{tab}
          </button>
        ))}</nav>
        <div className="sidebar-bottom"><span className="status-dot" /> Local environment <small>Development</small></div>
      </aside>

      <main className="main-content">
        <header className="topbar"><div><span className="breadcrumb">Workspace</span><span className="crumb-divider">/</span><strong>{activeTab}</strong></div><div className="topbar-right"><span className="environment-pill"><span className="status-dot" /> Local</span><div className="avatar">A</div></div></header>
        <section className="page-content">
          <div className="page-heading"><div><div className="eyebrow">CONTROL PLANE</div><h1>{activeTab === 'Overview' ? 'Good to see you.' : activeTab}</h1><p>Manage your connected tools, team access and store operations.</p></div><button className="button primary" onClick={checkHealth}>↻ Check gateway</button></div>
          <div className="connection-banner"><div className="banner-icon">⌘</div><div className="banner-copy"><strong>Gateway connection</strong><span>{health}</span></div><div className="gateway-input"><input aria-label="Gateway URL" value={gatewayUrl} onChange={(e) => setGatewayUrl(e.target.value)} /><button onClick={checkHealth}>Test</button></div></div>

          {activeTab === 'Overview' && <>
            <div className="stats-grid">
              <div className="stat-card"><div className="stat-top"><span>Registered servers</span><span className="stat-icon purple">⌘</span></div><strong>{servers.length.toString().padStart(2, '0')}</strong><small>Configured upstreams (preview)</small></div>
              <div className="stat-card"><div className="stat-top"><span>Connected servers</span><span className="stat-icon green">↗</span></div><strong>{servers.filter((s) => s.status === 'Connected').length.toString().padStart(2, '0')}</strong><small>Preview only</small></div>
              <div className="stat-card"><div className="stat-top"><span>Available tools</span><span className="stat-icon blue">✳</span></div><strong>{servers.filter((s) => s.status === 'Connected').reduce((sum, s) => sum + s.tools.length, 0).toString().padStart(2, '0')}</strong><small>Preview only</small></div>
              <div className="stat-card"><div className="stat-top"><span>Gateway health</span><span className="stat-icon amber">♥</span></div><strong className="health-value">{health.startsWith('ok') ? 'Healthy' : '—'}</strong><small>{health}</small></div>
            </div>
            <div className="section-heading"><div><h2>Connected MCP servers</h2><p>Configured tools (preview list)</p></div><button className="button secondary" onClick={() => setActiveTab('MCP Servers')}>Manage servers →</button></div>
            <div className="server-list">{servers.map((server) => <ServerCard key={server.name} server={server} onToggle={() => void toggleServer(server)} />)}</div>
            <div className="lower-grid"><div className="panel"><div className="panel-heading"><div><h2>Quick actions</h2><p>Common workspace tasks</p></div></div><button className="action-row" onClick={() => setActiveTab('API Keys')}><span className="action-icon">⚿</span><span><strong>Manage API keys</strong><small>Configure gateway access</small></span><b>→</b></button><button className="action-row" onClick={() => setActiveTab('Audit Logs')}><span className="action-icon">≋</span><span><strong>Review audit logs</strong><small>Inspect recorded tool calls</small></span><b>→</b></button><button className="action-row" onClick={() => setActiveTab('Chat Agent')}><span className="action-icon">✳</span><span><strong>Open chat agent</strong><small>Discover live Gateway tools</small></span><b>→</b></button></div><div className="panel"><div className="panel-heading"><div><h2>Security overview</h2><p>Current local configuration</p></div><span className="security-badge">Review</span></div><div className="security-row"><span>Gateway API key</span><strong>{apiKey ? 'Configured' : 'Not configured'}</strong></div><div className="security-row"><span>Upstream credentials</span><strong>Server-side only</strong></div><div className="security-row"><span>Admin features</span><strong>Admin key required</strong></div><p className="panel-note">Keys are held in page memory only. Never share or commit secrets.</p></div></div>
          </>}

          {activeTab === 'MCP Servers' && <div className="panel">
            <div className="panel-heading"><div><h2>Registered upstreams</h2><p>Persisted MCP endpoints. Admin access is required.</p></div><button className="button primary" disabled={busy} onClick={() => void loadUpstreams()}>{busy ? 'Working…' : 'Refresh upstreams'}</button></div>
            <div className="create-key-form"><input aria-label="Upstream name" value={newUpstreamName} onChange={(e) => setNewUpstreamName(e.target.value)} placeholder="Name (e.g. shipping)" maxLength={40} /><input aria-label="Upstream MCP URL" value={newUpstreamUrl} onChange={(e) => setNewUpstreamUrl(e.target.value)} placeholder="MCP URL (e.g. http://127.0.0.1:3005/mcp)" /><button className="button primary" disabled={busy} onClick={() => void addUpstream()}>Add upstream</button></div>
            {upstreamError && <p className="error-message">{upstreamError}</p>}
            <div className="server-list">{servers.map((server) => <ServerCard key={server.id ?? server.name} server={server} disabled={busy} onToggle={() => void toggleServer(server)} onEdit={() => void editUpstream(server)} onRemove={() => void removeUpstream(server)} showManagement />)}</div>
            {servers.length === 0 && <p className="empty-state">No upstreams loaded. Enter your admin key under API Keys, then refresh upstreams.</p>}
            <p className="panel-note">Changes are stored in the Gateway SQLite database and apply to subsequent MCP requests.</p>
          </div>}

          {activeTab === 'API Keys' && <div className="panel">
            <div className="panel-heading"><div><h2>API key management</h2><p>Admin access is required to list, create or revoke keys.</p></div><button className="button primary" disabled={busy} onClick={loadKeys}>{busy ? 'Loading…' : 'Refresh keys'}</button></div>
            <label className="field-label" htmlFor="gateway-key">Admin Gateway API key</label><input id="gateway-key" className="full-input" type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Paste admin API key here" />
            <div className="create-key-form"><input aria-label="New key label" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="New key label (e.g. teammate)" maxLength={100} /><select aria-label="New key role" value={newRole} onChange={(e) => setNewRole(e.target.value as 'admin' | 'member')}><option value="member">Member</option><option value="admin">Admin</option></select><button className="button primary" disabled={busy} onClick={createKey}>Create key</button></div>
            {keyError && <p className="error-message">{keyError}</p>}
            {createdKey && <div className="created-key"><strong>Copy this key now — it will not be shown again.</strong><code>{createdKey}</code><button className="button secondary" onClick={() => void navigator.clipboard?.writeText(createdKey)}>Copy key</button></div>}
            <div className="table-wrap"><table><thead><tr><th>Label</th><th>Role</th><th>Key ID</th><th>Action</th></tr></thead><tbody>{keyRows.map((row) => <tr key={row.id}><td>{row.label}</td><td><span className="role-pill">{row.role}</span></td><td><code>{row.id}</code></td><td><button className="button secondary small" disabled={busy} onClick={() => void revokeKey(row.id)}>Revoke</button></td></tr>)}</tbody></table>{keyRows.length === 0 && <p className="empty-state">No keys loaded. Enter an admin key and click Refresh keys.</p>}</div>
            <p className="panel-note">The Gateway prevents revoking the key used for the current admin request. Only the key ID is shown for existing keys.</p>
          </div>}

          {activeTab === 'Audit Logs' && <div className="panel"><div className="panel-heading"><div><h2>Audit activity</h2><p>Live events recorded by the Gateway backend.</p></div><button className="button primary" disabled={busy} onClick={loadAudit}>{busy ? 'Loading…' : 'Load audit logs'}</button></div>{auditError && <p className="error-message">{auditError}</p>}<div className="table-wrap"><table><thead><tr><th>Time</th><th>Key</th><th>Tool / action</th><th>Outcome</th><th>Details</th></tr></thead><tbody>{auditRows.map((event, index) => <tr key={event.id ?? index}><td>{String(event.timestamp ?? event.created_at ?? '—')}</td><td>{String(event.key_id ?? '—')}</td><td>{String(event.tool_name ?? event.action ?? '—')}</td><td>{String(event.outcome ?? '—')}</td><td><code>{JSON.stringify(event)}</code></td></tr>)}</tbody></table>{auditRows.length === 0 && <p className="empty-state">No audit events loaded yet.</p>}</div></div>}

          {activeTab === 'Chat Agent' && <div className="panel chat-panel"><div className="panel-heading"><div><h2>Store assistant</h2><p>Live MCP tool discovery · LLM loop not configured</p></div><button className="button secondary" disabled={busy} onClick={discoverTools}>Discover tools</button></div><div className="chat-messages">{chat.map((item, index) => <div key={index} className={`chat-message ${item.role}`}><strong>{item.role === 'user' ? 'You' : 'Urumi assistant'}</strong><p>{item.text}</p></div>)}</div><form className="chat-form" onSubmit={(e) => { e.preventDefault(); void sendMessage() }}><input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Ask about products, orders or stock…" /><button className="button primary" disabled={busy}>Send ↗</button></form></div>}

          {activeTab === 'Settings' && <div className="panel"><h2>Workspace settings</h2><p>Gateway endpoint: <code>{gatewayUrl}</code></p><p>Current health: <strong>{health}</strong></p><p className="panel-note">Production deployment and persistent upstream management are still pending.</p></div>}
          <footer className="footer"><span>URUMI MCP GATEWAY</span><span>Local development · Assignment dashboard</span></footer>
        </section>
      </main>
    </div>
  )
}

function ServerCard({ server, onToggle, disabled = false, onEdit, onRemove, showManagement = false }: { server: Server; onToggle: () => void; disabled?: boolean; onEdit?: () => void; onRemove?: () => void; showManagement?: boolean }) {
  const lowerName = server.name.toLowerCase()
  const logoClass = lowerName.includes('woo') ? 'woo' : lowerName.includes('analytic') || lowerName.includes('sales') ? 'analytics' : 'inventory'
  const logo = logoClass === 'woo' ? 'W' : logoClass === 'analytics' ? '↗' : '▦'
  return <article className="server-card"><div className={`server-logo ${logoClass}`}>{logo}</div><div className="server-info"><div className="server-title"><h3>{server.name}</h3><span className={`status-pill ${server.status.toLowerCase()}`}><span className="status-dot" />{server.status}</span></div><p>{server.description}</p>{server.url && <p><code>{server.url}</code></p>}<div className="tool-tags">{server.tools.map((tool) => <span key={tool}>{tool}</span>)}</div></div><div className="create-key-form"><button className="button secondary small" disabled={disabled} onClick={onToggle}>{server.enabled ? 'Disable' : 'Enable'}</button>{showManagement && <><button className="button secondary small" disabled={disabled} onClick={onEdit}>Edit</button><button className="button secondary small" disabled={disabled} onClick={onRemove}>Remove</button></>}</div></article>
}

export default App
