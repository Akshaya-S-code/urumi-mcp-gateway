import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import './App.css'

type ApiKey = { id: string; label: string; role: 'admin' | 'member'; revoked_at?: string | null; revoked?: boolean; created_at?: string; createdAt?: string }
type AuditEvent = { id?: string; occurred_at?: string; created_at?: string; key_id?: string; key_label?: string; role?: string; server_name?: string; tool_name?: string; duration_ms?: number; outcome?: string }
type Server = { id?: string; name: string; url?: string; enabled?: boolean; hasCredential?: boolean; lastError?: string; description: string; status: 'Connected' | 'Unreachable' | 'Disabled'; tools: string[] }

function App() {
  const [showRevokedKeys, setShowRevokedKeys] = useState(false)
  const [servers, setServers] = useState<Server[]>([])
  const [activeTab, setActiveTab] = useState('Overview')
  const [apiKey, setApiKey] = useState('')
  const [gatewayUrl, setGatewayUrl] = useState(() => {
    const host = window.location.hostname
    if (host.startsWith('dashboard.')) {
      const port = window.location.port ? `:${window.location.port}` : ''
      return `${window.location.protocol}//gateway.${host.slice('dashboard.'.length)}${port}`
    }
    return 'http://localhost:3002'
  })
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
  const [newCredentialHeader, setNewCredentialHeader] = useState('')
  const [newCredentialValue, setNewCredentialValue] = useState('')
  const [message, setMessage] = useState('')
  const [chat, setChat] = useState<{ role: string; text: string }[]>([
    { role: 'assistant', text: 'Welcome to Urumi. Enter your Gateway API key under API Keys to use the local Ollama assistant with authenticated MCP tools.' },
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
    setHealth('Checking...')
    try {
      const response = await fetch(`${baseUrl()}/health`)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const data = await response.json()
      setHealth(`${data.status ?? 'ok'} | ${data.service ?? 'Gateway'}`)
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
      setChat((items) => [...items, { role: 'assistant', text: `Discovered ${tools.length} Gateway tools:\n${tools.map((tool: { name: string; description?: string }) => `* ${tool.name}${tool.description ? ` - ${tool.description}` : ''}`).join('\n') || JSON.stringify(data, null, 2)}` }])
    } catch (error) {
      setChat((items) => [...items, { role: 'assistant', text: `Tool discovery failed: ${error instanceof Error ? error.message : 'request failed'}` }])
    } finally { setBusy(false) }
  }

  async function sendMessage() {
    const text = message.trim()
    if (!text || busy) return

    if (!apiKey.trim()) {
      setChat((items) => [...items, { role: 'assistant', text: 'Enter a valid Gateway API key under API Keys first.' }])
      return
    }

    const history = chat
      .filter((item) => item.role === 'user' || item.role === 'assistant')
      .slice(-12)

    setChat((items) => [...items, { role: 'user', text }])
    setMessage('')
    setBusy(true)

    try {
      const response = await fetch(`${baseUrl()}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders(),
        },
        body: JSON.stringify({ message: text, history }),
      })

      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error ?? `Chat request failed (HTTP ${response.status})`)
      }

      const usedTools = Array.isArray(data.toolCalls) && data.toolCalls.length
        ? `\n\nTools called: ${data.toolCalls.map((call: { name: string; outcome: string }) => `${call.name} (${call.outcome})`).join(', ')}`
        : ''
      setChat((items) => [...items, {
        role: 'assistant',
        text: (typeof data.reply === 'string' ? data.reply : 'The assistant returned no reply.') + usedTools,
      }])
    } catch (error) {
      setChat((items) => [...items, {
        role: 'assistant',
        text: `Chat failed: ${error instanceof Error ? error.message : 'Request failed'}`,
      }])
    } finally {
      setBusy(false)
    }
  }

  async function loadUpstreams() {
    setUpstreamError('')
    if (!apiKey.trim()) { setUpstreamError('Enter an admin API key in API Keys first.'); return }
    setBusy(true)
    try {
      const data = await requestJson('/admin/upstreams')
      const rows = Array.isArray(data) ? data : data.upstreams ?? []
      setServers(rows.map((row: { id: string; name: string; url: string; enabled: boolean; hasCredential?: boolean; status?: string; lastError?: string; tools?: Array<{ name: string }> }) => {
        const name = String(row.name)
        return {
          id: row.id,
          name,
          url: row.url,
          enabled: Boolean(row.enabled),
          hasCredential: Boolean(row.hasCredential),
          lastError: row.lastError,
          description: 'Streamable HTTP MCP upstream',
          status: row.status === 'disabled' ? 'Disabled' as const : row.status === 'connected' ? 'Connected' as const : 'Unreachable' as const,
          tools: Array.isArray(row.tools) ? row.tools.map((tool) => tool.name) : [],
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
    if (Boolean(newCredentialHeader.trim()) !== Boolean(newCredentialValue)) {
      setUpstreamError('Provide both a credential header and value, or leave both empty.')
      return
    }
    setBusy(true)
    try {
      await requestJson('/admin/upstreams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newUpstreamName.trim(), url: newUpstreamUrl.trim(), ...(newCredentialHeader.trim() ? { credentialHeader: newCredentialHeader.trim(), credentialValue: newCredentialValue } : {}) }),
      })
      setNewUpstreamName('')
      setNewUpstreamUrl('')
      setNewCredentialHeader('')
      setNewCredentialValue('')
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
    const credentialHeader = window.prompt('Replacement credential header (leave blank to keep the existing credential):', '')
    if (credentialHeader === null) return
    const credentialValue = credentialHeader.trim() ? window.prompt('Replacement credential value:', '') : ''
    if (credentialValue === null) return
    if (Boolean(credentialHeader.trim()) !== Boolean(credentialValue)) {
      setUpstreamError('Provide both a credential header and value to replace the stored credential.')
      return
    }
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
        body: JSON.stringify({ name: name.trim(), url: url.trim(), ...(credentialHeader.trim() ? { credentialHeader: credentialHeader.trim(), credentialValue } : {}) }),
      })
      await loadUpstreams()
    } catch (error) {
      setUpstreamError(error instanceof Error ? error.message : 'Could not edit upstream')
    } finally { setBusy(false) }
  }

  async function clearUpstreamCredential(server: Server) {
    if (!server.id || !window.confirm(`Remove the stored credential for "${server.name}"?`)) return
    setUpstreamError('')
    setBusy(true)
    try {
      await requestJson(`/admin/upstreams/${encodeURIComponent(server.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearCredential: true }),
      })
      await loadUpstreams()
    } catch (error) {
      setUpstreamError(error instanceof Error ? error.message : 'Could not clear upstream credential')
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
            <span className="nav-dot">{tab === 'Overview' ? 'O' : tab === 'MCP Servers' ? 'M' : tab === 'API Keys' ? 'K' : tab === 'Audit Logs' ? 'A' : tab === 'Chat Agent' ? 'C' : 'S'}</span>{tab}
          </button>
        ))}</nav>
        <div className="sidebar-bottom"><span className="status-dot" /> Local environment <small>Development</small></div>
      </aside>

      <main className="main-content">
        <header className="topbar"><div><span className="breadcrumb">Workspace</span><span className="crumb-divider">/</span><strong>{activeTab}</strong></div><div className="topbar-right"><span className="environment-pill"><span className="status-dot" /> Local</span><div className="avatar">A</div></div></header>
        <section className="page-content">
          <div className="page-heading"><div><div className="eyebrow">CONTROL PLANE</div><h1>{activeTab === 'Overview' ? 'Good to see you.' : activeTab}</h1><p>Manage your connected tools, team access and store operations.</p></div><button className="button primary" onClick={checkHealth}>-&gt; Check gateway</button></div>
          <div className="connection-banner"><div className="banner-icon">M</div><div className="banner-copy"><strong>Gateway connection</strong><span>{health}</span></div><div className="gateway-input"><input aria-label="Gateway URL" value={gatewayUrl} onChange={(e) => setGatewayUrl(e.target.value)} /><button onClick={checkHealth}>Test</button></div></div>

          {activeTab === 'Overview' && <>
            <div className="stats-grid">
              <div className="stat-card"><div className="stat-top"><span>Registered servers</span><span className="stat-icon purple">M</span></div><strong>{servers.length.toString().padStart(2, '0')}</strong><small>Live Gateway configuration</small></div>
              <div className="stat-card"><div className="stat-top"><span>Connected servers</span><span className="stat-icon green">Send</span></div><strong>{servers.filter((s) => s.status === 'Connected').length.toString().padStart(2, '0')}</strong><small>Live health checks</small></div>
              <div className="stat-card"><div className="stat-top"><span>Available tools</span><span className="stat-icon blue">C</span></div><strong>{servers.filter((s) => s.status === 'Connected').reduce((sum, s) => sum + s.tools.length, 0).toString().padStart(2, '0')}</strong><small>Discovered from connected servers</small></div>
              <div className="stat-card"><div className="stat-top"><span>Gateway health</span><span className="stat-icon amber">*</span></div><strong className="health-value">{health.startsWith('ok') ? 'Healthy' : '-'}</strong><small>{health}</small></div>
            </div>
            <div className="section-heading"><div><h2>Registered MCP servers</h2><p>Live status and discovered tools from the Gateway</p></div><button className="button secondary" disabled={busy} onClick={() => { void checkHealth(); void loadUpstreams() }}>{busy ? 'Refreshing...' : 'Refresh live status'}</button></div>
            {upstreamError && <p className="error-message">{upstreamError}</p>}
            <div className="server-list">{servers.map((server) => <ServerCard key={server.id ?? server.name} server={server} disabled={busy} onToggle={() => void toggleServer(server)} />)}</div>
            {servers.length === 0 && <p className="empty-state">Enter an admin Gateway key in API Keys, then refresh live status to load registered servers.</p>}
            <div className="lower-grid"><div className="panel"><div className="panel-heading"><div><h2>Quick actions</h2><p>Common workspace tasks</p></div></div><button className="action-row" onClick={() => setActiveTab('API Keys')}><span className="action-icon">K</span><span><strong>Manage API keys</strong><small>Configure gateway access</small></span><b>-&gt;</b></button><button className="action-row" onClick={() => setActiveTab('Audit Logs')}><span className="action-icon">A</span><span><strong>Review audit logs</strong><small>Inspect recorded tool calls</small></span><b>-&gt;</b></button><button className="action-row" onClick={() => setActiveTab('Chat Agent')}><span className="action-icon">C</span><span><strong>Open chat agent</strong><small>Discover live Gateway tools</small></span><b>-&gt;</b></button></div><div className="panel"><div className="panel-heading"><div><h2>Security overview</h2><p>Current local configuration</p></div><span className="security-badge">Review</span></div><div className="security-row"><span>Gateway API key</span><strong>{apiKey ? 'Configured' : 'Not configured'}</strong></div><div className="security-row"><span>Upstream credentials</span><strong>Server-side only</strong></div><div className="security-row"><span>Admin features</span><strong>Admin key required</strong></div><p className="panel-note">Keys are held in page memory only. Never share or commit secrets.</p></div></div>
          </>}

          {activeTab === 'MCP Servers' && <div className="panel">
            <div className="panel-heading"><div><h2>Registered upstreams</h2><p>Persisted MCP endpoints. Admin access is required.</p></div><button className="button primary" disabled={busy} onClick={() => void loadUpstreams()}>{busy ? 'Working...' : 'Refresh upstreams'}</button></div>
            <div className="create-key-form"><input aria-label="Upstream name" value={newUpstreamName} onChange={(e) => setNewUpstreamName(e.target.value)} placeholder="Name (e.g. shipping)" maxLength={40} /><input aria-label="Upstream MCP URL" value={newUpstreamUrl} onChange={(e) => setNewUpstreamUrl(e.target.value)} placeholder="MCP URL (e.g. http://127.0.0.1:3005/mcp)" /><input aria-label="Optional credential header" value={newCredentialHeader} onChange={(e) => setNewCredentialHeader(e.target.value)} placeholder="Optional header (e.g. Authorization)" /><input aria-label="Optional credential value" type="password" autoComplete="new-password" value={newCredentialValue} onChange={(e) => setNewCredentialValue(e.target.value)} placeholder="Optional credential value" /><button className="button primary" disabled={busy} onClick={() => void addUpstream()}>Add upstream</button></div>
            {upstreamError && <p className="error-message">{upstreamError}</p>}
            <div className="server-list">{servers.map((server) => <ServerCard key={server.id ?? server.name} server={server} disabled={busy} onToggle={() => void toggleServer(server)} onEdit={() => void editUpstream(server)} onRemove={() => void removeUpstream(server)} onClearCredential={() => void clearUpstreamCredential(server)} showManagement />)}</div>
            {servers.length === 0 && <p className="empty-state">No upstreams loaded. Enter your admin key under API Keys, then refresh upstreams.</p>}
            <p className="panel-note">Changes are stored in the Gateway SQLite database and apply to subsequent MCP requests.</p>
          </div>}

          {activeTab === 'API Keys' && <div className="panel">
            <div className="panel-heading"><div><h2>API key management</h2><p>Admin access is required to list, create or revoke keys.</p></div><button className="button primary" disabled={busy} onClick={loadKeys}>{busy ? 'Loading...' : 'Refresh keys'}</button><button className="button secondary" onClick={() => setShowRevokedKeys((value) => !value)}>{showRevokedKeys ? 'Hide revoked' : 'Show revoked'}</button></div>
            <label className="field-label" htmlFor="gateway-key">Admin Gateway API key</label><input id="gateway-key" className="full-input" type="password" autoComplete="off" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Paste admin API key here" />
            <div className="create-key-form"><input aria-label="New key label" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="New key label (e.g. teammate)" maxLength={100} /><select aria-label="New key role" value={newRole} onChange={(e) => setNewRole(e.target.value as 'admin' | 'member')}><option value="member">Member</option><option value="admin">Admin</option></select><button className="button primary" disabled={busy} onClick={createKey}>Create key</button></div>
            {keyError && <p className="error-message">{keyError}</p>}
            {createdKey && <div className="created-key"><strong>Copy this key now - it will not be shown again.</strong><code>{createdKey}</code><button className="button secondary" onClick={() => void navigator.clipboard?.writeText(createdKey)}>Copy key</button></div>}
            <div className="table-wrap"><table><thead><tr><th>Label</th><th>Role</th><th>Key ID</th><th>Action</th></tr></thead><tbody>{keyRows.filter((row) => showRevokedKeys || !(row.revoked_at || row.revoked)).map((row) => <tr key={row.id}><td>{row.label}</td><td><span className="role-pill">{row.role}</span></td><td><code>{row.id}</code></td><td>{row.revoked_at || row.revoked ? <span className="role-pill">Revoked</span> : <button className="button secondary small" disabled={busy || !row.id} onClick={() => void revokeKey(row.id)}>Revoke</button>}</td></tr>)}</tbody></table>{keyRows.length === 0 && <p className="empty-state">No keys loaded. Enter an admin key and click Refresh keys.</p>}</div>
            <p className="panel-note">The Gateway prevents revoking the key used for the current admin request. Only the key ID is shown for existing keys.</p>
          </div>}

          {activeTab === 'Audit Logs' && <div className="panel"><div className="panel-heading"><div><h2>Audit activity</h2><p>Every tool call is attributed to its API-key identity.</p></div><button className="button primary" disabled={busy} onClick={loadAudit}>{busy ? 'Loading...' : 'Load audit logs'}</button></div>{auditError && <p className="error-message">{auditError}</p>}<div className="table-wrap"><table><thead><tr><th>Time</th><th>User / key</th><th>Server</th><th>Tool</th><th>Duration</th><th>Outcome</th></tr></thead><tbody>{auditRows.map((event, index) => <tr key={event.id ?? index}><td>{String(event.occurred_at ?? event.created_at ?? '-')}</td><td>{String(event.key_label ?? event.key_id ?? '-')}<br/><small>{String(event.role ?? '')}</small></td><td>{String(event.server_name ?? '-')}</td><td><code>{String(event.tool_name ?? '-')}</code></td><td>{typeof event.duration_ms === 'number' ? `${event.duration_ms} ms` : '-'}</td><td>{String(event.outcome ?? '-')}</td></tr>)}</tbody></table>{auditRows.length === 0 && <p className="empty-state">No audit events loaded yet.</p>}</div></div>}

          {activeTab === 'Chat Agent' && <div className="panel chat-panel"><div className="panel-heading"><div><h2>Store assistant</h2><p>Local Ollama assistant | authenticated MCP tools</p></div><button className="button secondary" disabled={busy} onClick={discoverTools}>Discover tools</button></div><div className="chat-messages">{chat.map((item, index) => <div key={index} className={`chat-message ${item.role}`}><strong>{item.role === 'user' ? 'You' : 'Urumi assistant'}</strong><div className="markdown-content"><ReactMarkdown remarkPlugins={[remarkGfm]}>{item.text.replace(/\\\|/g, "|")}</ReactMarkdown></div></div>)}</div><form className="chat-form" onSubmit={(e) => { e.preventDefault(); void sendMessage() }}><input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Ask about products, orders or stock..." /><button className="button primary" disabled={busy}>Send</button></form></div>}

          {activeTab === 'Settings' && <div className="panel"><h2>Workspace settings</h2><p>Gateway endpoint: <code>{gatewayUrl}</code></p><p>Current health: <strong>{health}</strong></p><p className="panel-note">Local and production deployments use the same Helm charts. Set environment-specific domains, storage, image references, and Secret references in the matching values files.</p></div>}
          <footer className="footer"><span>URUMI MCP GATEWAY</span><span>Local development | Assignment dashboard</span></footer>
        </section>
      </main>
    </div>
  )
}

function ServerCard({ server, onToggle, disabled = false, onEdit, onRemove, onClearCredential, showManagement = false }: { server: Server; onToggle: () => void; disabled?: boolean; onEdit?: () => void; onRemove?: () => void; onClearCredential?: () => void; showManagement?: boolean }) {
  const lowerName = server.name.toLowerCase()
  const logoClass = lowerName.includes('woo') ? 'woo' : lowerName.includes('analytic') || lowerName.includes('sales') ? 'analytics' : 'inventory'
  const logo = logoClass === 'woo' ? 'W' : logoClass === 'analytics' ? 'Send' : 'â–¦'
  return <article className="server-card"><div className={`server-logo ${logoClass}`}>{logo}</div><div className="server-info"><div className="server-title"><h3>{server.name}</h3><span className={`status-pill ${server.status.toLowerCase()}`}><span className="status-dot" />{server.status}</span></div><p>{server.description}</p>{server.url && <p><code>{server.url}</code></p>}{server.lastError && <p className="error-message">Probe failed: {server.lastError}</p>}{showManagement && <p>{server.hasCredential ? 'Credential configured (value hidden)' : 'No credential configured'}</p>}<div className="tool-tags">{server.tools.map((tool) => <span key={tool}>{tool}</span>)}</div></div><div className="create-key-form"><button className="button secondary small" disabled={disabled} onClick={onToggle}>{server.enabled ? 'Disable' : 'Enable'}</button>{showManagement && <><button className="button secondary small" disabled={disabled} onClick={onEdit}>Edit</button>{server.hasCredential && <button className="button secondary small" disabled={disabled} onClick={onClearCredential}>Clear credential</button>}<button className="button secondary small" disabled={disabled} onClick={onRemove}>Remove</button></>}</div></article>
}

export default App
