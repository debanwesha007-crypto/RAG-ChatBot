import { useEffect, useRef, useState } from 'react'

const API_BASE = '/api'

function useSession() {
  const [sessionId, setSessionId] = useState(null)
  useEffect(() => {
    fetch(`${API_BASE}/session`, { method: 'POST' })
      .then((r) => r.json())
      .then((d) => setSessionId(d.session_id))
  }, [])
  return sessionId
}

export default function App() {
  const sessionId = useSession()
  const [documents, setDocuments] = useState([])
  const [selectedDocs, setSelectedDocs] = useState(new Set())
  const [uploading, setUploading] = useState(false)
  const [uploadResults, setUploadResults] = useState([])
  const [messages, setMessages] = useState([]) // {role, content, citations?}
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [backend, setBackend] = useState('ollama')
  const chatEndRef = useRef(null)
  const fileInputRef = useRef(null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function refreshDocuments() {
    if (!sessionId) return
    const r = await fetch(`${API_BASE}/documents/${sessionId}`)
    const d = await r.json()
    setDocuments(d.documents)
  }

  useEffect(() => {
    if (sessionId) refreshDocuments()
  }, [sessionId])

  async function handleFiles(fileList) {
    if (!sessionId || !fileList.length) return
    setUploading(true)
    const form = new FormData()
    for (const file of fileList) form.append('files', file)
    try {
      const r = await fetch(`${API_BASE}/upload/${sessionId}`, { method: 'POST', body: form })
      if (!r.ok) {
        const err = await r.json()
        setUploadResults([{ filename: '(batch)', status: 'error', error: err.detail }])
      } else {
        const results = await r.json()
        setUploadResults(results)
      }
      await refreshDocuments()
    } finally {
      setUploading(false)
    }
  }

  function toggleDoc(name) {
    setSelectedDocs((prev) => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }

  async function sendMessage() {
    const question = input.trim()
    if (!question || streaming || !documents.length) return
    setInput('')
    const history = messages.map((m) => ({ role: m.role, content: m.content }))
    setMessages((prev) => [...prev, { role: 'user', content: question }, { role: 'assistant', content: '', citations: [] }])
    setStreaming(true)

    try {
      const resp = await fetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          question,
          history,
          top_k: 6,
          filenames: selectedDocs.size ? Array.from(selectedDocs) : null,
          backend,
        }),
      })
      if (!resp.ok || !resp.body) {
        const err = await resp.json().catch(() => ({ detail: 'Request failed' }))
        appendToLastAssistant(`\n\n[Error: ${err.detail}]`)
        setStreaming(false)
        return
      }

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const events = buffer.split('\n\n')
        buffer = events.pop() // keep incomplete tail

        for (const raw of events) {
          const lines = raw.split('\n')
          const eventLine = lines.find((l) => l.startsWith('event: '))
          const dataLine = lines.find((l) => l.startsWith('data: '))
          if (!eventLine || !dataLine) continue
          const eventType = eventLine.replace('event: ', '')
          const data = JSON.parse(dataLine.replace('data: ', ''))

          if (eventType === 'citations') {
            setMessages((prev) => {
              const copy = [...prev]
              copy[copy.length - 1] = { ...copy[copy.length - 1], citations: data }
              return copy
            })
          } else if (eventType === 'token') {
            appendToLastAssistant(data.text)
          } else if (eventType === 'error') {
            appendToLastAssistant(`\n\n[Error: ${data.message}]`)
          }
        }
      }
    } catch (e) {
      appendToLastAssistant(`\n\n[Connection error: ${e.message}]`)
    } finally {
      setStreaming(false)
    }
  }

  function appendToLastAssistant(text) {
    setMessages((prev) => {
      const copy = [...prev]
      const last = copy[copy.length - 1]
      copy[copy.length - 1] = { ...last, content: last.content + text }
      return copy
    })
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>📄 Multi-PDF RAG</h1>

        <section className="panel">
          <label className="upload-btn">
            {uploading ? 'Processing…' : `Upload PDFs (${documents.length}/50)`}
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              multiple
              hidden
              disabled={uploading}
              onChange={(e) => handleFiles(Array.from(e.target.files))}
            />
          </label>
          {uploadResults.length > 0 && (
            <ul className="upload-log">
              {uploadResults.map((r, i) => (
                <li key={i} className={r.status}>
                  {r.filename} — {r.status}
                  {r.error ? `: ${r.error}` : r.status !== 'error' ? ` (${r.pages}p, ${r.chunks} chunks)` : ''}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel">
          <div className="panel-title">Documents ({documents.length})</div>
          <div className="doc-hint">Select to scope questions; none selected = search all</div>
          <ul className="doc-list">
            {documents.map((name) => (
              <li key={name}>
                <label>
                  <input
                    type="checkbox"
                    checked={selectedDocs.has(name)}
                    onChange={() => toggleDoc(name)}
                  />
                  {name}
                </label>
              </li>
            ))}
          </ul>
        </section>

        <section className="panel">
          <div className="panel-title">LLM Backend</div>
          <select value={backend} onChange={(e) => setBackend(e.target.value)}>
            <option value="ollama">Local (Ollama)</option>
            <option value="anthropic">API (Anthropic)</option>
            <option value="openai">API (OpenAI)</option>
          </select>
        </section>
      </aside>

      <main className="chat">
        <div className="messages">
          {messages.length === 0 && (
            <div className="empty-state">Upload PDFs, then ask a question grounded in them.</div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={`message ${m.role}`}>
              <div className="bubble">
                <p style={{ whiteSpace: 'pre-wrap' }}>{m.content}</p>
                {m.citations && m.citations.length > 0 && (
                  <div className="citations">
                    {m.citations.map((c, j) => (
                      <span key={j} className="citation-chip">
                        {c.filename} · p.{c.page_number}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          <div ref={chatEndRef} />
        </div>

        <div className="input-row">
          <input
            type="text"
            placeholder={documents.length ? 'Ask about your documents…' : 'Upload a PDF first…'}
            value={input}
            disabled={!documents.length || streaming}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
          />
          <button onClick={sendMessage} disabled={!documents.length || streaming || !input.trim()}>
            {streaming ? '…' : 'Send'}
          </button>
        </div>
      </main>
    </div>
  )
}
