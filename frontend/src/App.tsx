import type { FormEvent, ReactNode } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Send,
  Square,
  RotateCcw,
  Download,
  ChevronDown,
  Sparkles,
  Globe,
  Shield,
  Zap,
  BookOpen,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Loader2,
  MessageSquare,
} from 'lucide-react'


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
        className="inline-flex items-center gap-1 text-hcl-blue-500 bg-hcl-blue-50 border border-hcl-blue-200 rounded-full px-2 py-0.5 text-[11px] font-bold no-underline hover:bg-hcl-blue-100 transition-colors"
        href={url}
        target="_blank"
        rel="noreferrer"
        key={`${url}-${index}`}
      >
        <Globe className="w-3 h-3" />
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

function TypingIndicator() {
  return (
    <div className="flex items-center gap-1.5 px-4 py-2">
      <span className="w-2 h-2 rounded-full bg-hcl-blue-400 animate-[pulseDot_1.4s_ease-in-out_infinite]" />
      <span className="w-2 h-2 rounded-full bg-hcl-teal-400 animate-[pulseDot_1.4s_ease-in-out_0.2s_infinite]" />
      <span className="w-2 h-2 rounded-full bg-hcl-blue-300 animate-[pulseDot_1.4s_ease-in-out_0.4s_infinite]" />
    </div>
  )
}

function ConfidenceBadge({ confidence }: { confidence: Confidence }) {
  const config = {
    HIGH: {
      bg: 'bg-emerald-50',
      border: 'border-emerald-200',
      badge: 'bg-emerald-600',
      icon: <CheckCircle2 className="w-4 h-4 text-emerald-600" />,
    },
    MEDIUM: {
      bg: 'bg-amber-50',
      border: 'border-amber-200',
      badge: 'bg-amber-600',
      icon: <Clock className="w-4 h-4 text-amber-600" />,
    },
    LOW: {
      bg: 'bg-red-50',
      border: 'border-red-200',
      badge: 'bg-red-600',
      icon: <AlertTriangle className="w-4 h-4 text-red-600" />,
    },
  }[confidence.level]

  return (
    <div className={`mt-4 rounded-xl border ${config.border} ${config.bg} p-3 animate-fade-in`}>
      <div className="flex items-start gap-3">
        {config.icon}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className={`${config.badge} text-white text-[11px] font-bold px-2 py-0.5 rounded-full`}>
              {confidence.level}
            </span>
            <span className="text-[12px] font-semibold text-hcl-navy-400">Confidence</span>
          </div>
          <p className="text-[13px] text-hcl-navy-500 leading-relaxed">{confidence.reason}</p>
        </div>
      </div>
    </div>
  )
}

function ReasoningPanel({ steps, complete }: { steps: ReasoningStep[]; complete?: boolean }) {
  const [open, setOpen] = useState(!complete)

  return (
    <div className="mb-4 rounded-xl border border-hcl-blue-100 bg-gradient-to-br from-hcl-blue-50/60 to-white overflow-hidden animate-fade-in">
      <button
        type="button"
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-hcl-blue-50/40 transition-colors"
        onClick={() => setOpen(!open)}
      >
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-hcl-blue-500" />
          <span className="text-[13px] font-bold text-hcl-blue-700">Reasoning Steps</span>
          <span className="text-[11px] font-semibold text-hcl-blue-400 bg-hcl-blue-100 rounded-full px-2 py-0.5">
            {steps.length}
          </span>
        </div>
        <ChevronDown className={`w-4 h-4 text-hcl-blue-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <ol className="px-4 pb-4 space-y-3 animate-fade-in">
          {steps.map((step, index) => (
            <li key={`${step.timestamp}-${index}`} className="flex gap-3 animate-slide-up" style={{ animationDelay: `${index * 60}ms` }}>
              <div className="flex flex-col items-center">
                <div className="w-6 h-6 rounded-full bg-hcl-blue-500 text-white flex items-center justify-center text-[10px] font-bold shrink-0">
                  {index + 1}
                </div>
                {index < steps.length - 1 && <div className="w-0.5 flex-1 bg-hcl-blue-200 mt-1" />}
              </div>
              <div className="flex-1 pb-2 min-w-0">
                <span className="block text-[11px] font-bold text-hcl-teal-600 uppercase tracking-wide mb-0.5">
                  {step.type.replaceAll('_', ' ')}
                </span>
                <p className="text-[13px] text-hcl-navy-500 leading-relaxed">{step.message}</p>
                {step.input && (
                  <code className="block mt-2 text-[12px] text-hcl-navy-600 bg-white border border-hcl-blue-100 rounded-lg px-3 py-2 leading-relaxed whitespace-pre-wrap font-mono">
                    {step.input}
                  </code>
                )}
                {step.sub_questions && (
                  <ul className="mt-2 space-y-1">
                    {step.sub_questions.map((sq) => (
                      <li key={sq} className="flex items-start gap-1.5 text-[12px] text-hcl-navy-400">
                        <span className="text-hcl-teal-500 mt-0.5">-</span>
                        {sq}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function ContradictionPanel({ report }: { report: ContradictionReport }) {
  const [open, setOpen] = useState(false)
  const isWarning = report.has_conflicts

  return (
    <div className={`mt-4 rounded-xl border animate-fade-in ${
      isWarning ? 'border-amber-200 bg-amber-50/60' : 'border-emerald-200 bg-emerald-50/60'
    }`}>
      <div className="px-4 py-3">
        <div className="flex items-center gap-2 mb-1">
          {isWarning ? (
            <AlertTriangle className="w-4 h-4 text-amber-600" />
          ) : (
            <Shield className="w-4 h-4 text-emerald-600" />
          )}
          <h2 className={`text-[13px] font-bold uppercase tracking-wide ${
            isWarning ? 'text-amber-700' : 'text-emerald-700'
          }`}>
            {report.has_conflicts ? 'Conflicts detected' : 'Sources agree'}
          </h2>
        </div>
        <p className="text-[13px] text-hcl-navy-500 leading-relaxed">{report.summary}</p>
        {report.items.length > 0 && (
          <div className="mt-2">
            <button
              type="button"
              className="text-[12px] font-bold text-hcl-blue-500 hover:text-hcl-blue-700 flex items-center gap-1 transition-colors"
              onClick={() => setOpen(!open)}
            >
              View conflicts
              <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
              <ul className="mt-3 space-y-2 animate-fade-in">
                {report.items.map((conflict, index) => (
                  <li key={`${conflict.source_a}-${index}`} className="border border-amber-200 rounded-lg bg-white/80 p-3">
                    <p className="text-[13px] text-hcl-navy-600 mb-1">{conflict.claim_a}</p>
                    <a href={conflict.source_a} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-bold text-hcl-blue-500 hover:text-hcl-blue-700 mr-3">
                      <Globe className="w-3 h-3" /> Source A
                    </a>
                    <p className="text-[13px] text-hcl-navy-600 mt-2 mb-1">{conflict.claim_b}</p>
                    <a href={conflict.source_b} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-bold text-hcl-blue-500 hover:text-hcl-blue-700">
                      <Globe className="w-3 h-3" /> Source B
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function SourcesPanel({ citations }: { citations: Citation[] }) {
  return (
    <div className="mt-4 border-t border-hcl-blue-100 pt-4 animate-fade-in">
      <div className="flex items-center gap-2 mb-3">
        <BookOpen className="w-4 h-4 text-hcl-blue-500" />
        <h2 className="text-[12px] font-bold text-hcl-navy-400 uppercase tracking-wide">Sources</h2>
        <span className="text-[11px] font-semibold text-hcl-blue-500 bg-hcl-blue-50 rounded-full px-2 py-0.5">
          {citations.length}
        </span>
      </div>
      <ul className="space-y-2">
        {citations.map((source) => (
          <li key={source.url} className="border border-hcl-blue-100 rounded-xl bg-white p-3 hover:border-hcl-blue-200 hover:shadow-hcl transition-all duration-200">
            <a href={source.url} target="_blank" rel="noreferrer"
              className="block text-[13px] font-bold text-hcl-blue-600 hover:text-hcl-blue-800 no-underline transition-colors">
              {source.title}
            </a>
            <span className="block mt-0.5 text-[11px] text-hcl-navy-300">{freshnessLabel(source)}</span>
            {source.snippet && <p className="mt-1.5 text-[12px] text-hcl-navy-400 leading-relaxed">{source.snippet}</p>}
          </li>
        ))}
      </ul>
    </div>
  )
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
    <main className="min-h-screen gradient-hcl-mesh flex items-start justify-center p-4 sm:p-6 md:p-8">
      <section className="w-full max-w-[1080px] min-h-[calc(100vh-64px)] flex flex-col bg-white/95 backdrop-blur-sm border border-hcl-blue-100 rounded-2xl shadow-hcl-xl overflow-hidden">
        {/* Header */}
        <header className="flex items-center justify-between gap-4 px-6 py-5 border-b border-hcl-blue-100 bg-gradient-to-r from-hcl-blue-50/50 to-transparent">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="w-4 h-4 text-hcl-teal-500" />
              <p className="text-[12px] font-bold text-hcl-teal-600 uppercase tracking-widest">
                Real-Time AI Query Agent
              </p>
            </div>
            <h1 className="text-xl font-bold text-hcl-navy-500 leading-tight">
              Grounded answers with feedback loops
            </h1>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              onClick={resetChat}
              className="flex items-center gap-1.5 px-3 py-2 text-[13px] font-semibold text-hcl-navy-400 bg-white border border-hcl-blue-100 rounded-lg hover:bg-hcl-blue-50 hover:border-hcl-blue-200 transition-all duration-200"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              New chat
            </button>
            <div className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-[13px] font-bold border transition-all duration-300 ${
              isStreaming
                ? 'text-hcl-teal-700 border-hcl-teal-300 bg-hcl-teal-50'
                : 'text-hcl-navy-300 border-hcl-blue-100 bg-white'
            }`}>
              <span className={`w-2 h-2 rounded-full transition-colors duration-300 ${
                isStreaming ? 'bg-hcl-teal-500 animate-pulse' : 'bg-hcl-navy-200'
              }`} />
              {isStreaming ? 'Live' : 'Ready'}
            </div>
          </div>
        </header>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6 scrollbar-hcl" aria-live="polite">
          {messages.map((message) => (
            <article
              className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'} animate-slide-up`}
              key={message.id}
            >
              <div className={`w-fit max-w-[min(760px,86%)] rounded-2xl ${
                message.role === 'user'
                  ? 'bg-gradient-to-br from-hcl-blue-500 to-hcl-blue-700 text-white shadow-hcl'
                  : 'bg-white border border-hcl-blue-100 shadow-hcl'
              }`}>
              <div className="px-5 py-4">
                {/* Status indicator */}
                {message.status && (
                  <div className="flex items-center gap-2 mb-3">
                    <Loader2 className="w-3.5 h-3.5 text-hcl-blue-500 animate-spin" />
                    <span className="text-[12px] font-bold text-hcl-blue-500">{message.status}</span>
                  </div>
                )}

                {/* Reasoning */}
                {message.reasoning && message.reasoning.length > 0 && (
                  <ReasoningPanel steps={message.reasoning} complete={message.complete} />
                )}

                {/* Answer text */}
                <div className="text-[14px] leading-[1.65] whitespace-pre-wrap break-words">
                  {message.content ? (
                    <span className={message.role === 'user' ? 'text-white' : 'text-hcl-navy-600'}>
                      {renderAnswer(message.content)}
                    </span>
                  ) : !message.complete ? (
                    <div className="flex flex-col gap-2.5 py-2">
                      <div className="h-3.5 rounded-lg bg-gradient-to-r from-hcl-blue-100 via-hcl-blue-50 to-hcl-blue-100 bg-[length:200%_100%] animate-shimmer w-[85%]" />
                      <div className="h-3.5 rounded-lg bg-gradient-to-r from-hcl-blue-100 via-hcl-blue-50 to-hcl-blue-100 bg-[length:200%_100%] animate-shimmer w-[55%]" />
                    </div>
                  ) : null}
                </div>

                {/* Typing indicator while streaming empty content */}
                {!message.content && !message.complete && message.status === 'Answering' && <TypingIndicator />}

                {/* Confidence */}
                {message.confidence && <ConfidenceBadge confidence={message.confidence} />}

                {/* Contradictions */}
                {message.contradictions && <ContradictionPanel report={message.contradictions} />}

                {/* Sources */}
                {message.role === 'assistant' && message.complete && (message.citations?.length ?? 0) > 0 && (
                  <SourcesPanel citations={message.citations!} />
                )}

                {/* Actions */}
                {message.role === 'assistant' && message.complete && message.content && (
                  <div className="flex justify-end mt-4">
                    <button
                      type="button"
                      onClick={() => exportMarkdown(message)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold text-hcl-navy-400 bg-hcl-blue-50 border border-hcl-blue-100 rounded-lg hover:bg-hcl-blue-100 hover:border-hcl-blue-200 transition-all duration-200"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Export
                    </button>
                  </div>
                )}

                {/* Follow-ups */}
                {message.followups && message.followups.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-4">
                    {message.followups.map((followup) => (
                      <button
                        type="button"
                        key={followup}
                        onClick={() => void submitQuery(followup)}
                        className="flex items-center gap-1.5 px-3 py-2 text-[12px] font-bold text-hcl-blue-600 bg-white border border-hcl-blue-200 rounded-xl hover:bg-hcl-blue-50 hover:border-hcl-blue-300 hover:shadow-hcl transition-all duration-200 text-left"
                      >
                        <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                        {followup}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              </div>
            </article>
          ))}
          <div ref={messagesEndRef} />
        </div>

        {/* Error */}
        {error && (
          <div className="mx-6 mb-3 flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-[13px] font-semibold text-red-700 animate-fade-in">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            {error}
          </div>
        )}

        {/* Composer */}
        <form className="px-6 pb-6 pt-3" onSubmit={sendMessage}>
          <div className="flex gap-3 items-end">
            <div className="flex-1 relative">
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
                className="w-full resize-none border border-hcl-blue-200 rounded-xl px-4 py-3 text-[14px] text-hcl-navy-600 bg-white placeholder:text-hcl-navy-300 leading-relaxed focus:outline-none focus:ring-2 focus:ring-hcl-blue-500/20 focus:border-hcl-blue-400 transition-all duration-200"
              />
            </div>
            {isStreaming ? (
              <button
                type="button"
                onClick={stopStreaming}
                className="flex items-center gap-2 px-5 py-3 bg-red-600 text-white rounded-xl text-[14px] font-bold hover:bg-red-700 transition-colors shrink-0"
              >
                <Square className="w-4 h-4" />
                Stop
              </button>
            ) : (
              <button
                type="submit"
                disabled={!query.trim()}
                className="flex items-center gap-2 px-5 py-3 gradient-hcl text-white rounded-xl text-[14px] font-bold hover:shadow-hcl-lg disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 shrink-0"
              >
                <Send className="w-4 h-4" />
                Send
              </button>
            )}

          </div>
        </form>
      </section>
    </main>
  )
}

export default App
