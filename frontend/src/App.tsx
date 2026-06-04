import { useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import './App.css'

type Role = 'user' | 'assistant'

type Source = {
  title: string
  url: string
  snippet: string
  published_date?: string | null
}

type Message = {
  id: string
  role: Role
  content: string
  status?: string
  sources?: Source[]
}

type SseEvent = {
  event: string
  data: string
}

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'

function parseSse(buffer: string): { events: SseEvent[]; rest: string } {
  const events: SseEvent[] = []
  const chunks = buffer.split('\n\n')
  const rest = chunks.pop() ?? ''

  for (const chunk of chunks) {
    const lines = chunk.split('\n')
    const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim() ?? 'message'
    const data = lines
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n')
    events.push({ event, data })
  }

  return { events, rest }
}

function App() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: 'Ask me a question. I can answer normally, search for current information, and keep context within this chat.',
    },
  ])
  const [query, setQuery] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState('')
  const sessionId = useMemo(() => crypto.randomUUID(), [])
  const abortRef = useRef<AbortController | null>(null)

  async function sendMessage(event?: Pick<FormEvent, 'preventDefault'>) {
    event?.preventDefault()
    const trimmed = query.trim()
    if (!trimmed || isStreaming) return

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmed,
    }
    const assistantId = crypto.randomUUID()
    const assistantMessage: Message = {
      id: assistantId,
      role: 'assistant',
      content: '',
      status: 'Connecting',
      sources: [],
    }

    setMessages((current) => [...current, userMessage, assistantMessage])
    setQuery('')
    setError('')
    setIsStreaming(true)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const response = await fetch(`${apiUrl}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: trimmed, session_id: sessionId }),
        signal: controller.signal,
      })

      if (!response.ok || !response.body) {
        throw new Error(`Request failed with status ${response.status}`)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const parsed = parseSse(buffer)
        buffer = parsed.rest

        for (const item of parsed.events) {
          const payload = JSON.parse(item.data)

          if (item.event === 'token') {
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? { ...message, content: message.content + payload.token, status: 'Answering' }
                  : message,
              ),
            )
          }

          if (item.event === 'status') {
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? { ...message, status: payload.message, sources: payload.sources ?? message.sources }
                  : message,
              ),
            )
          }

          if (item.event === 'done') {
            setMessages((current) =>
              current.map((message) =>
                message.id === assistantId
                  ? { ...message, status: undefined, sources: payload.sources ?? message.sources }
                  : message,
              ),
            )
          }

          if (item.event === 'error') {
            throw new Error(payload.message)
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        const message = (err as Error).message
        setError(message)
        setMessages((current) =>
          current.map((item) =>
            item.id === assistantId && !item.content
              ? { ...item, content: message, status: undefined }
              : item,
          ),
        )
      }
    } finally {
      abortRef.current = null
      setIsStreaming(false)
    }
  }

  function stopStreaming() {
    abortRef.current?.abort()
    setIsStreaming(false)
  }

  return (
    <main className="app-shell">
      <section className="chat-panel" aria-label="AI Query Agent chat">
        <header className="topbar">
          <div>
            <p className="eyebrow">Real-Time AI Query Agent</p>
            <h1>Ask, search, and stream answers</h1>
          </div>
          <span className={isStreaming ? 'status live' : 'status'}>{isStreaming ? 'Live' : 'Ready'}</span>
        </header>

        <div className="messages" aria-live="polite">
          {messages.map((message) => (
            <article className={`message ${message.role}`} key={message.id}>
              <div className="bubble">
                {message.status && <p className="message-status">{message.status}</p>}
                <p>{message.content || 'Waiting for the first token...'}</p>
                {message.sources && message.sources.length > 0 && (
                  <div className="sources">
                    {message.sources.map((source) => (
                      <a href={source.url} target="_blank" rel="noreferrer" key={source.url}>
                        {source.title}
                      </a>
                    ))}
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>

        {error && <p className="error">{error}</p>}

        <form className="composer" onSubmit={sendMessage}>
          <textarea
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void sendMessage()
              }
            }}
            placeholder="Ask about current AI news, a company update, or a follow-up..."
            rows={2}
          />
          {isStreaming ? (
            <button type="button" className="secondary" onClick={stopStreaming}>
              Stop
            </button>
          ) : (
            <button type="submit" disabled={!query.trim()}>
              Send
            </button>
          )}
        </form>
      </section>
    </main>
  )
}

export default App
