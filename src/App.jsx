import { useEffect, useRef, useState } from 'react'

const API_BASE = '/api'

function useSession() {
  const [sessionId, setSessionId] = useState(null)

  useEffect(() => {
    fetch(`${API_BASE}/session`, { method: 'POST' })
      .then((r) => r.json())
      .then((d) => setSessionId(d.session_id))
      .catch((err) => console.error('Session error:', err))
  }, [])

  return sessionId
}

function App() {
  const sessionId = useSession()

  const [documents, setDocuments] = useState([])
  const [selectedDocs, setSelectedDocs] = useState(new Set())
  const [uploading, setUploading] = useState(false)
  const [uploadResults, setUploadResults] = useState([])
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [backend, setBackend] = useState('ollama')
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const chatEndRef = useRef(null)
  const fileInputRef = useRef(null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function refreshDocuments() {
    if (!sessionId) return

    try {
      const response = await fetch(`${API_BASE}/documents/${sessionId}`)
      const data = await response.json()
      setDocuments(data.documents || [])
    } catch (error) {
      console.error('Document refresh error:', error)
    }
  }

  useEffect(() => {
    if (sessionId) refreshDocuments()
  }, [sessionId])

  async function handleFiles(fileList) {
    if (!sessionId || !fileList.length) return

    setUploading(true)
    setUploadResults([])

    const form = new FormData()

    for (const file of fileList) {
      form.append('files', file)
    }

    try {
      const response = await fetch(`${API_BASE}/upload/${sessionId}`, {
        method: 'POST',
        body: form,
      })

      if (!response.ok) {
        const error = await response.json()
        setUploadResults([
          {
            filename: '(batch)',
            status: 'error',
            error: error.detail || 'Upload failed',
          },
        ])
      } else {
        const results = await response.json()
        setUploadResults(results)
      }

      await refreshDocuments()
    } catch (error) {
      setUploadResults([
        {
          filename: '(batch)',
          status: 'error',
          error: error.message,
        },
      ])
    } finally {
      setUploading(false)

      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  function toggleDoc(name) {
    setSelectedDocs((previous) => {
      const next = new Set(previous)

      if (next.has(name)) {
        next.delete(name)
      } else {
        next.add(name)
      }

      return next
    })
  }

  function appendToLastAssistant(text) {
    setMessages((previous) => {
      const copy = [...previous]
      const last = copy[copy.length - 1]

      if (!last) return previous

      copy[copy.length - 1] = {
        ...last,
        content: last.content + text,
      }

      return copy
    })
  }

  async function sendMessage() {
    const question = input.trim()

    if (!question || streaming || !documents.length) return

    setInput('')

    const history = messages.map((message) => ({
      role: message.role,
      content: message.content,
    }))

    setMessages((previous) => [
      ...previous,
      { role: 'user', content: question },
      { role: 'assistant', content: '', citations: [] },
    ])

    setStreaming(true)

    try {
      const response = await fetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          session_id: sessionId,
          question,
          history,
          top_k: 6,
          filenames: selectedDocs.size
            ? Array.from(selectedDocs)
            : null,
          backend,
        }),
      })

      if (!response.ok || !response.body) {
        const error = await response
          .json()
          .catch(() => ({ detail: 'Request failed' }))

        appendToLastAssistant(
          `\n\n[Error: ${error.detail || 'Request failed'}]`
        )

        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { value, done } = await reader.read()

        if (done) break

        buffer += decoder.decode(value, { stream: true })

        const events = buffer.split('\n\n')
        buffer = events.pop()

        for (const rawEvent of events) {
          const lines = rawEvent.split('\n')
          const eventLine = lines.find((line) =>
            line.startsWith('event: ')
          )
          const dataLine = lines.find((line) =>
            line.startsWith('data: ')
          )

          if (!eventLine || !dataLine) continue

          const eventType = eventLine.replace('event: ', '')
          const data = JSON.parse(
            dataLine.replace('data: ', '')
          )

          if (eventType === 'citations') {
            setMessages((previous) => {
              const copy = [...previous]

              copy[copy.length - 1] = {
                ...copy[copy.length - 1],
                citations: data,
              }

              return copy
            })
          }

          if (eventType === 'token') {
            appendToLastAssistant(data.text)
          }

          if (eventType === 'error') {
            appendToLastAssistant(
              `\n\n[Error: ${data.message}]`
            )
          }
        }
      }
    } catch (error) {
      appendToLastAssistant(
        `\n\n[Connection error: ${error.message}]`
      )
    } finally {
      setStreaming(false)
    }
  }

  function clearChat() {
    setMessages([])
  }

  return (
    <div className="app-shell">
      <div className="background-grid" />

      <header className="topbar">
        <div className="brand-area">
          <button
            className="mobile-menu-button"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            aria-label="Toggle sidebar"
          >
            ☰
          </button>

          <div className="brand-icon">◈</div>

          <div>
            <div className="brand-name">NEXUS RAG</div>
            <div className="brand-subtitle">
              ROBOTIC KNOWLEDGE INTERFACE
            </div>
          </div>
        </div>

        <div className="system-status">
          <span className="status-dot" />
          <span>SYSTEM ONLINE</span>
          <span className="status-divider">|</span>
          <span className="session-label">
            {sessionId ? 'SESSION ACTIVE' : 'CONNECTING...'}
          </span>
        </div>
      </header>

      <div className="workspace">
        <aside className={`sidebar ${sidebarOpen ? 'sidebar-open' : ''}`}>
          <div className="sidebar-heading">
            <span>CONTROL PANEL</span>
            <span className="panel-code">SYS.01</span>
          </div>

          <section className="control-card">
            <div className="card-heading">
              <span className="card-icon">↥</span>
              <div>
                <h3>Knowledge Upload</h3>
                <p>Import PDF documents</p>
              </div>
            </div>

            <label className="upload-zone">
              <span className="upload-symbol">
                {uploading ? '◌' : '＋'}
              </span>

              <strong>
                {uploading
                  ? 'PROCESSING FILES'
                  : 'UPLOAD DOCUMENTS'}
              </strong>

              <small>
                {documents.length}/50 documents indexed
              </small>

              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                multiple
                hidden
                disabled={uploading}
                onChange={(event) =>
                  handleFiles(Array.from(event.target.files))
                }
              />
            </label>

            {uploadResults.length > 0 && (
              <div className="upload-results">
                {uploadResults.map((result, index) => (
                  <div
                    key={index}
                    className={`upload-result ${result.status}`}
                  >
                    <span>
                      {result.status === 'error' ? '×' : '✓'}
                    </span>

                    <div>
                      <strong>{result.filename}</strong>
                      <small>
                        {result.error ||
                          `${result.pages || 0} pages · ${
                            result.chunks || 0
                          } chunks`}
                      </small>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="control-card document-card">
            <div className="card-heading">
              <span className="card-icon">▤</span>
              <div>
                <h3>Document Matrix</h3>
                <p>
                  {selectedDocs.size
                    ? `${selectedDocs.size} selected`
                    : 'Searching all documents'}
                </p>
              </div>
            </div>

            <div className="document-list">
              {documents.length === 0 ? (
                <div className="empty-documents">
                  No documents indexed yet.
                </div>
              ) : (
                documents.map((name) => (
                  <label className="document-item" key={name}>
                    <input
                      type="checkbox"
                      checked={selectedDocs.has(name)}
                      onChange={() => toggleDoc(name)}
                    />

                    <span className="document-file-icon">
                      PDF
                    </span>

                    <span className="document-name" title={name}>
                      {name}
                    </span>

                    <span className="document-check">
                      {selectedDocs.has(name) ? '✓' : ''}
                    </span>
                  </label>
                ))
              )}
            </div>
          </section>

          <section className="control-card">
            <div className="card-heading">
              <span className="card-icon">◉</span>
              <div>
                <h3>Neural Engine</h3>
                <p>Choose response backend</p>
              </div>
            </div>

            <select
              className="backend-select"
              value={backend}
              onChange={(event) => setBackend(event.target.value)}
            >
              <option value="ollama">Local Engine · Ollama</option>
              <option value="anthropic">Cloud Engine · Anthropic</option>
              <option value="openai">Cloud Engine · OpenAI</option>
            </select>
          </section>

          <div className="sidebar-footer">
            <div className="footer-status">
              <span className="status-dot" />
              VECTOR DATABASE READY
            </div>

            <div className="footer-status">
              <span className="status-dot purple" />
              RETRIEVAL SYSTEM READY
            </div>
          </div>
        </aside>

        <main className="chat-area">
          <div className="chat-header">
            <div>
              <div className="chat-eyebrow">
                / CORE INTERFACE / CHAT MODULE
              </div>

              <h1>Ask your knowledge base.</h1>

              <p>
                Query your indexed documents using retrieval-augmented
                generation.
              </p>
            </div>

            <button
              className="clear-button"
              onClick={clearChat}
              disabled={!messages.length}
            >
              ↻ Clear
            </button>
          </div>

          <div className="chat-content">
            {messages.length === 0 ? (
              <div className="welcome-panel">
                <div className="robot-orbit">
                  <div className="orbit-ring ring-one" />
                  <div className="orbit-ring ring-two" />
                  <div className="robot-core">◈</div>
                </div>

                <div className="welcome-copy">
                  <span className="welcome-tag">
                    AI KNOWLEDGE SYSTEM
                  </span>

                  <h2>Ready for your next query.</h2>

                  <p>
                    Upload one or more PDFs, then ask a question.
                    The system will retrieve relevant information
                    and generate a grounded response.
                  </p>
                </div>

                <div className="quick-actions">
                  <button
                    onClick={() =>
                      setInput('Summarize the uploaded documents')
                    }
                    disabled={!documents.length}
                  >
                    Summarize documents
                  </button>

                  <button
                    onClick={() =>
                      setInput('What are the key concepts in these documents?')
                    }
                    disabled={!documents.length}
                  >
                    Find key concepts
                  </button>
                </div>
              </div>
            ) : (
              <div className="messages">
                {messages.map((message, index) => (
                  <div
                    key={index}
                    className={`message-row ${message.role}`}
                  >
                    <div className="message-avatar">
                      {message.role === 'user' ? 'U' : '◈'}
                    </div>

                    <div className="message-body">
                      <div className="message-meta">
                        {message.role === 'user'
                          ? 'YOU'
                          : 'NEXUS AI'}

                        <span>
                          {message.role === 'user'
                            ? 'USER INPUT'
                            : 'GENERATED RESPONSE'}
                        </span>
                      </div>

                      <div className="message-bubble">
                        <p>{message.content}</p>

                        {message.citations &&
                          message.citations.length > 0 && (
                            <div className="citations">
                              <div className="citation-title">
                                SOURCE REFERENCES
                              </div>

                              {message.citations.map(
                                (citation, citationIndex) => (
                                  <span
                                    key={citationIndex}
                                    className="citation-chip"
                                  >
                                    {citation.filename} · p.
                                    {citation.page_number}
                                  </span>
                                )
                              )}
                            </div>
                          )}
                      </div>
                    </div>
                  </div>
                ))}

                {streaming && (
                  <div className="typing-indicator">
                    <span />
                    <span />
                    <span />
                    Generating response...
                  </div>
                )}

                <div ref={chatEndRef} />
              </div>
            )}
          </div>

          <div className="composer-wrapper">
            <div className="composer-label">
              <span className="status-dot" />
              {documents.length
                ? `${documents.length} DOCUMENTS AVAILABLE`
                : 'UPLOAD A DOCUMENT TO BEGIN'}
            </div>

            <div className="composer">
              <input
                type="text"
                placeholder={
                  documents.length
                    ? 'Enter your query...'
                    : 'Upload a PDF before asking a question'
                }
                value={input}
                disabled={!documents.length || streaming}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') sendMessage()
                }}
              />

              <button
                className="send-button"
                onClick={sendMessage}
                disabled={
                  !documents.length ||
                  streaming ||
                  !input.trim()
                }
              >
                {streaming ? '◌' : '➤'}
              </button>
            </div>

            <div className="composer-hint">
              Press Enter to send · Responses are grounded in your
              selected documents
            </div>
          </div>
        </main>
      </div>
    </div>
  )
}

export default App