import type { FormEvent, ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'

type Role = 'user' | 'assistant'
type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW'

type Source = {
  title: string
  url: string
  snippet: string
  published_date?: string | null
}

type Citation = Source & {
  cited_at: string
}

type Confidence = {
  level: ConfidenceLevel
  reason: string
}

type ReasoningStep = {
  type: string
  tool_name: string
  input: string
  message: string
  timestamp: string
  sub_questions?: string[]
  sources?: Source[]
  attempt?: number
  max_attempts?: number
}

type Contradiction = {
  source_a: string
  claim_a: string
  source_b: string
  claim_b: string
}

type ContradictionReport = {
  has_conflicts: boolean
  summary: string
  items: Contradiction[]
}

type Message = {
  id: string
  role: Role
  content: string
  question?: string
  status?: string
  sources?: Source[]
  citations?: Citation[]
  confidence?: Confidence | null
  reasoning?: ReasoningStep[]
  contradictions?: ContradictionReport
  followups?: string[]
  complete?: boolean
}

type SseEvent = {
  event: string
  data: string
}

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'
const sourcePattern = /\[Source:\s*(https?:\/\/[^\]\s]+)\s*\]/g

const WELCOME_MESSAGE: Message = {
  id: crypto.randomUUID(),
  role: 'assistant',
  content:
    'Ask me a question. I can search for current information, show the steps I took, cite sources, detect conflicts, and suggest follow-ups.',
  complete: true,
  reasoning: [],
  citations: [],
  sources: [],
  followups: [],
}

function parseSse(buffer: string): { events: SseEvent[]; rest: string } {
  const events: SseEvent[] = []
  const chunks = buffer.split('\n\n')
  const rest = chunks.pop() ?? ''

  for (const chunk of chunks) {
    const lines = chunk.split('\n')
    const event =
      lines.find((line) => line.startsWith('event:'))?.slice(6).trim() ?? 'message'
    const data = lines
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n')
    events.push({ event, data })
  }

  return { events, rest }
}

function renderAnswer(content: string): ReactNode[] {
  const parts: ReactNode[] = []
  let lastIndex = 0

  for (const match of content.matchAll(sourcePattern)) {
    const fullMatch = match[0]
    const url = match[1].replace(/[.,)]$/, '')
    const index = match.index ?? 0

    if (index > lastIndex) {
      parts.push(content.slice(lastIndex, index))
    }

    parts.push(
      <a
        className="inline-source"
        href={url}
        target="_blank"
        rel="noreferrer"
        key={`${url}-${index}`}
      >
        Source
      </a>,
    )
    lastIndex = index + fullMatch.length
  }

  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex))
  }

  return parts.length > 0 ? parts : [content]
}

function freshnessLabel(source: Source): string {
  return source.published_date || 'date unknown'
}

function updateAssistant(
  assistantId: string,
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>,
  updater: (message: Message) => Message,
) {
  setMessages((current) =>
    current.map((message) => (message.id === assistantId ? updater(message) : message)),
  )
}

function exportMarkdown(message: Message) {
  const citations = message.citations ?? []
  const confidence = message.confidence
    ? `${message.confidence.level}: ${message.confidence.reason}`
    : 'Not rated'
  const sources = citations.length
    ? citations.map((source, index) => `${index + 1}. [${source.title}](${source.url})`).join('\n')
    : 'No cited sources.'

  const markdown = `# AI Query Agent Answer

## Question
${message.question ?? 'Untitled question'}

## Answer
${message.content}

## Confidence
${confidence}

## Sources
${sources}
`

  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'ai-query-agent-answer.md'
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function App() {
  const [messages, setMessages] = useState<Message[]>([WELCOME_MESSAGE])
  const [query, setQuery] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState('')
  const sessionId = useMemo(() => crypto.randomUUID(), [])
  const abortRef = useRef<AbortController | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function submitQuery(rawQuery: string) {
    const trimmed = rawQuery.trim()
    if (!trimmed || isStreaming) return

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: trimmed,
      complete: true,
    }
    const assistantId = crypto.randomUUID()
    const assistantMessage: Message = {
      id: assistantId,
      role: 'assistant',
      question: trimmed,
      content: '',
      status: 'Connecting',
      sources: [],
      citations: [],
      reasoning: [],
      followups: [],
      complete: false,
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
            updateAssistant(assistantId, setMessages, (message) => ({
              ...message,
              content: message.content + payload.token,
              status: 'Answering',
            }))
          }

          if (item.event === 'tool_call') {
            updateAssistant(assistantId, setMessages, (message) => ({
              ...message,
              status: payload.message,
              sources: payload.sources ?? message.sources,
              reasoning: [...(message.reasoning ?? []), payload],
            }))
          }

          if (item.event === 'confidence') {
            updateAssistant(assistantId, setMessages, (message) => ({
              ...message,
              confidence: payload,
            }))
          }

          if (item.event === 'contradictions') {
            updateAssistant(assistantId, setMessages, (message) => ({
              ...message,
              contradictions: payload,
            }))
          }

          if (item.event === 'followups') {
            updateAssistant(assistantId, setMessages, (message) => ({
              ...message,
              followups: payload.questions ?? [],
            }))
          }

          if (item.event === 'done') {
            updateAssistant(assistantId, setMessages, (message) => ({
              ...message,
              status: undefined,
              sources: payload.sources ?? message.sources,
              citations: payload.citations ?? [],
              confidence: payload.confidence ?? message.confidence,
              contradictions: payload.contradictions ?? message.contradictions,
              followups: payload.followups ?? message.followups,
              complete: true,
            }))
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
        updateAssistant(assistantId, setMessages, (item) => ({
          ...item,
          content: item.content || message,
          status: undefined,
          complete: true,
        }))
      }
    } finally {
      abortRef.current = null
      setIsStreaming(false)
    }
  }

  function sendMessage(event?: Pick<FormEvent, 'preventDefault'>) {
    event?.preventDefault()
    void submitQuery(query)
  }

  function stopStreaming() {
    abortRef.current?.abort()
    setIsStreaming(false)
  }

  function resetChat() {
    if (isStreaming) stopStreaming()
    setMessages([{ ...WELCOME_MESSAGE, id: crypto.randomUUID() }])
    setQuery('')
    setError('')
  }

  return (
    <main className="app-shell">
      <section className="chat-panel" aria-label="AI Query Agent chat">
        <header className="topbar">
          <div>
            <p className="eyebrow">Real-Time AI Query Agent</p>
            <h1>Grounded answers with feedback loops</h1>
          </div>
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <button type="button" className="new-chat" onClick={resetChat}>
              New chat
            </button>
            <span className={isStreaming ? 'status live' : 'status'}>
              {isStreaming ? 'Live' : 'Ready'}
            </span>
          </div>
        </header>

        <div className="messages" aria-live="polite">
          {messages.map((message) => (
            <article className={`message ${message.role}`} key={message.id}>
              <div className="bubble">
                {message.status && <p className="message-status">{message.status}</p>}

                {message.reasoning && message.reasoning.length > 0 && (
                  <details className="reasoning" open={!message.complete}>
                    <summary>Reasoning</summary>
                    <ol>
                      {message.reasoning.map((step, index) => (
                        <li key={`${step.timestamp}-${index}`}>
                          <span>{step.type.replaceAll('_', ' ')}</span>
                          <p>{step.message}</p>
                          {step.input && <code>{step.input}</code>}
                          {step.sub_questions && (
                            <ul className="subquestions">
                              {step.sub_questions.map((subQuestion) => (
                                <li key={subQuestion}>{subQuestion}</li>
                              ))}
                            </ul>
                          )}
                        </li>
                      ))}
                    </ol>
                  </details>
                )}

                <div className="answer-text">
                  {message.content
                    ? renderAnswer(message.content)
                    : !message.complete && (
                        <div className="skeleton">
                          <div className="skeleton-line" />
                          <div className="skeleton-line short" />
                        </div>
                      )}
                </div>

                {message.confidence && (
                  <div className={`confidence ${message.confidence.level.toLowerCase()}`}>
                    <span>{message.confidence.level}</span>
                    <p>{message.confidence.reason}</p>
                  </div>
                )}

                {message.contradictions && (
                  <div
                    className={
                      message.contradictions.has_conflicts ? 'conflicts warning' : 'conflicts'
                    }
                  >
                    <h2>
                      {message.contradictions.has_conflicts
                        ? 'Conflicts detected'
                        : 'Sources agree'}
                    </h2>
                    <p>{message.contradictions.summary}</p>
                    {message.contradictions.items.length > 0 && (
                      <details>
                        <summary>View conflicts</summary>
                        <ul>
                          {message.contradictions.items.map((conflict, index) => (
                            <li key={`${conflict.source_a}-${index}`}>
                              <p>{conflict.claim_a}</p>
                              <a href={conflict.source_a} target="_blank" rel="noreferrer">
                                Source A
                              </a>
                              <p>{conflict.claim_b}</p>
                              <a href={conflict.source_b} target="_blank" rel="noreferrer">
                                Source B
                              </a>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                )}

                {message.role === 'assistant' &&
                  message.complete &&
                  (message.citations?.length ?? 0) > 0 && (
                    <div className="sources-panel">
                      <h2>Sources</h2>
                      <ul>
                        {message.citations?.map((source) => (
                          <li key={source.url}>
                            <a href={source.url} target="_blank" rel="noreferrer">
                              {source.title}
                            </a>
                            <span>{freshnessLabel(source)}</span>
                            {source.snippet && <p>{source.snippet}</p>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                {message.role === 'assistant' && message.complete && message.content && (
                  <div className="answer-actions">
                    <button
                      type="button"
                      className="compact"
                      onClick={() => exportMarkdown(message)}
                    >
                      Export
                    </button>
                  </div>
                )}

                {message.followups && message.followups.length > 0 && (
                  <div className="followups">
                    {message.followups.map((followup) => (
                      <button
                        type="button"
                        key={followup}
                        onClick={() => void submitQuery(followup)}
                      >
                        {followup}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </article>
          ))}
          {/* Sentinel — keeps view scrolled to latest message */}
          <div ref={messagesEndRef} />
        </div>

        {error && <p className="error">{error}</p>}

        <form className="composer" onSubmit={sendMessage}>
          <textarea
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                sendMessage()
              }
            }}
            placeholder="Ask about current AI news, a company update, or a complex comparison..."
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
