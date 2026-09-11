import { useEffect, useRef, useState } from 'react'

const API_BASE = '/api'

function useSession() {
  const [sessionId, setSessionId] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function createSession() {
      try {
        const response = await fetch(`${API_BASE}/session`, {
          method: 'POST',
        })

        if (!response.ok) {
          throw new Error(`Session request failed: ${response.status}`)
        }

        const data = await response.json()

        if (!cancelled) {
          setSessionId(data.session_id)
        }
      } catch (error) {
        console.error('Session error:', error)
      }
    }

    createSession()

    return () => {
      cancelled = true
    }
  }, [])

  return sessionId
}

export default function App() {
  const sessionId = useSession()

  const [documents, setDocuments] = useState([])
  const [selectedDocs, setSelectedDocs] = useState(new Set())
  const [uploading, setUploading] = useState(false)
  const [uploadResults, setUploadResults] = useState([])
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [backend, setBackend] = useState('ollama')

  const chatEndRef = useRef(null)
  const fileInputRef = useRef(null)

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({
      behavior: 'smooth',
    })
  }, [messages])

  async function refreshDocuments() {
    if (!sessionId) return

    try {
      const response = await fetch(`${API_BASE}/documents/${sessionId}`)

      if (!response.ok) {
        throw new Error(`Failed to load documents: ${response.status}`)
      }

      const data = await response.json()

      setDocuments(Array.isArray(data.documents) ? data.documents : [])
    } catch (error) {
      console.error('Document loading error:', error)
    }
  }

  useEffect(() => {
    if (sessionId) {
      refreshDocuments()
    }
  }, [sessionId])

  async function handleFiles(fileList) {
    if (!sessionId || !fileList?.length) return

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
        const errorData = await response
          .json()
          .catch(() => ({ detail: 'Upload failed' }))

        setUploadResults([
          {
            filename: '(batch)',
            status: 'error',
            error: errorData.detail || 'Upload failed',
          },
        ])

        return
      }

      const results = await response.json()

      setUploadResults(Array.isArray(results) ? results : [])

      await refreshDocuments()
    } catch (error) {
      console.error('Upload error:', error)

      setUploadResults([
        {
          filename: '(batch)',
          status: 'error',
          error: error.message || 'Upload failed',
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

  async function sendMessage() {
    const question = input.trim()

    if (!question || streaming || !documents.length || !sessionId) {
      return
    }

    setInput('')

    const history = messages.map((message) => ({
      role: message.role,
      content: message.content,
    }))

    setMessages((previous) => [
      ...previous,
      {
        role: 'user',
        content: question,
      },
      {
        role: 'assistant',
        content: '',
        citations: [],
      },
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
        const errorData = await response
          .json()
          .catch(() => ({ detail: 'Request failed' }))

        appendToLastAssistant(
          `\n\n[Error: ${errorData.detail || 'Request failed'}]`,
        )

        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()

      let buffer = ''

      while (true) {
        const { value, done } = await reader.read()

        if (done) break

        buffer += decoder.decode(value, {
          stream: true,
        })

        const events = buffer.split('\n\n')

        buffer = events.pop() || ''

        for (const rawEvent of events) {
          const lines = rawEvent.split('\n')

          const eventLine = lines.find((line) =>
            line.startsWith('event: '),
          )

          const dataLine = lines.find((line) =>
            line.startsWith('data: '),
          )

          if (!eventLine || !dataLine) {
            continue
          }

          const eventType = eventLine.replace('event: ', '')
          const rawData = dataLine.replace('data: ', '')

          let data

          try {
            data = JSON.parse(rawData)
          } catch (error) {
            console.error('Invalid stream data:', rawData)
            continue
          }

          if (eventType === 'citations') {
            setMessages((previous) => {
              if (!previous.length) return previous

              const copy = [...previous]
              const lastIndex = copy.length - 1

              copy[lastIndex] = {
                ...copy[lastIndex],
                citations: Array.isArray(data) ? data : [],
              }

              return copy
            })
          } else if (eventType === 'token') {
            appendToLastAssistant(data.text || '')
          } else if (eventType === 'error') {
            appendToLastAssistant(
              `\n\n[Error: ${data.message || 'Unknown error'}]`,
            )
          }
        }
      }
    } catch (error) {
      appendToLastAssistant(
        `\n\n[Connection error: ${error.message || 'Unknown error'}]`,
      )
    } finally {
      setStreaming(false)
    }
  }

  function appendToLastAssistant(text) {
    if (!text) return

    setMessages((previous) => {
      if (!previous.length) return previous

      const copy = [...previous]
      const lastIndex = copy.length - 1
      const lastMessage = copy[lastIndex]

      copy[lastIndex] = {
        ...lastMessage,
        content: `${lastMessage.content || ''}${text}`,
      }

      return copy
    })
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>📄 Multi-PDF RAG</h1>

        <section className="panel">
          <label className="upload-btn">
            {uploading
              ? 'Processing…'
              : `Upload PDFs (${documents.length}/50)`}

            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              multiple
              hidden
              disabled={uploading}
              onChange={(event) =>
                handleFiles(
                  Array.from(event.target.files || []),
                )
              }
            />
          </label>

          {uploadResults.length > 0 && (
            <ul className="upload-log">
              {uploadResults.map((result, index) => (
                <li
                  key={`${result.filename || 'file'}-${index}`}
                  className={result.status}
                >
                  {result.filename} — {result.status}

                  {result.error
                    ? `: ${result.error}`
                    : result.status !== 'error'
                      ? ` (${result.pages || 0}p, ${
                          result.chunks || 0
                        } chunks)`
                      : ''}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel">
          <div className="panel-title">
            Documents ({documents.length})
          </div>

          <div className="doc-hint">
            Select to scope questions; none selected = search all
          </div>

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

          <select
            value={backend}
            onChange={(event) => setBackend(event.target.value)}
          >
            <option value="ollama">Local (Ollama)</option>
            <option value="anthropic">API (Anthropic)</option>
            <option value="openai">API (OpenAI)</option>
          </select>
        </section>
      </aside>

      <main className="chat">
        <div className="messages">
          {messages.length === 0 && (
            <div className="empty-state">
              Upload PDFs, then ask a question grounded in them.
            </div>
          )}

          {messages.map((message, index) => (
            <div
              key={index}
              className={`message ${message.role}`}
            >
              <div className="bubble">
                <p style={{ whiteSpace: 'pre-wrap' }}>
                  {message.content}
                </p>

                {message.citations &&
                  message.citations.length > 0 && (
                    <div className="citations">
                      {message.citations.map((citation, citationIndex) => (
                        <span
                          key={citationIndex}
                          className="citation-chip"
                        >
                          {citation.filename} · p.
                          {citation.page_number}
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
            placeholder={
              documents.length
                ? 'Ask about your documents…'
                : 'Upload a PDF first…'
            }
            value={input}
            disabled={!documents.length || streaming}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                sendMessage()
              }
            }}
          />

          <button
            onClick={sendMessage}
            disabled={
              !documents.length ||
              streaming ||
              !input.trim()
            }
          >
            {streaming ? '…' : 'Send'}
          </button>
        </div>
      </main>
    </div>
  )
}