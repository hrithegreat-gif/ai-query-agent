import type { FormEvent, ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
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
  Moon,
  Sun,
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

type ChatSession = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  messages: Message[]
}

type SseEvent = {
  event: string
  data: string
}

const apiUrl = import.meta.env.VITE_API_URL ?? ''
const chatUrl = apiUrl ? `${apiUrl}/chat` : '/api/chat'
const sourcePattern = /\[Source:\s*(https?:\/\/[^\]\s]+)\s*\]/g

function createWelcomeMessage(): Message {
  return {
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
}

function createSession(title = 'New chat', messages: Message[] = [createWelcomeMessage()]): ChatSession {
  return {
    id: crypto.randomUUID(),
    title,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages,
  }
}

function loadStoredSessions(): ChatSession[] {
  if (typeof window === 'undefined') {
    return []
  }

  try {
    const raw = window.localStorage.getItem('ai-query-agent-sessions')
    if (!raw) {
      return []
    }
    const parsed = JSON.parse(raw) as ChatSession[]
    return parsed.filter((session) => session && typeof session.id === 'string')
  } catch {
    return []
  }
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
        className="inline-flex items-center gap-1 text-hcl-blue-500 bg-hcl-blue-50 border border-hcl-blue-200 rounded-full px-2 py-0.5 text-[11px] font-bold no-underline hover:bg-hcl-blue-100 transition-colors dark:bg-slate-800 dark:border-slate-700 dark:text-hcl-blue-300"
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
      bg: 'bg-emerald-50 dark:bg-emerald-950/40',
      border: 'border-emerald-200 dark:border-emerald-900',
      badge: 'bg-emerald-600',
      icon: <CheckCircle2 className="w-4 h-4 text-emerald-600" />,
    },
    MEDIUM: {
      bg: 'bg-amber-50 dark:bg-amber-950/40',
      border: 'border-amber-200 dark:border-amber-900',
      badge: 'bg-amber-600',
      icon: <Clock className="w-4 h-4 text-amber-600" />,
    },
    LOW: {
      bg: 'bg-red-50 dark:bg-red-950/40',
      border: 'border-red-200 dark:border-red-900',
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
            <span className="text-[12px] font-semibold text-hcl-navy-400 dark:text-slate-300">Confidence</span>
          </div>
          <p className="text-[13px] text-hcl-navy-500 leading-relaxed dark:text-slate-400">{confidence.reason}</p>
        </div>
      </div>
    </div>
  )
}

function ReasoningPanel({ steps, complete }: { steps: ReasoningStep[]; complete?: boolean }) {
  const [open, setOpen] = useState(!complete)

  return (
    <div className="mb-4 rounded-xl border border-hcl-blue-100 bg-gradient-to-br from-hcl-blue-50/60 to-white overflow-hidden animate-fade-in dark:border-slate-800 dark:from-slate-800/80 dark:to-slate-900">
      <button
        type="button"
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-hcl-blue-50/40 transition-colors dark:hover:bg-slate-800/70"
        onClick={() => setOpen(!open)}
      >
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-hcl-blue-500" />
          <span className="text-[13px] font-bold text-hcl-blue-700 dark:text-hcl-blue-300">Reasoning Steps</span>
          <span className="text-[11px] font-semibold text-hcl-blue-400 bg-hcl-blue-100 rounded-full px-2 py-0.5 dark:bg-slate-800 dark:text-slate-300">
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
                {index < steps.length - 1 && <div className="w-0.5 flex-1 bg-hcl-blue-200 mt-1 dark:bg-slate-700" />}
              </div>
              <div className="flex-1 pb-2 min-w-0">
                <span className="block text-[11px] font-bold text-hcl-teal-600 uppercase tracking-wide mb-0.5 dark:text-hcl-teal-400">
                  {step.type.replaceAll('_', ' ')}
                </span>
                <p className="text-[13px] text-hcl-navy-500 leading-relaxed dark:text-slate-400">{step.message}</p>
                {step.input && (
                  <code className="block mt-2 text-[12px] text-hcl-navy-600 bg-white border border-hcl-blue-100 rounded-lg px-3 py-2 leading-relaxed whitespace-pre-wrap font-mono dark:bg-slate-950 dark:border-slate-700 dark:text-slate-300">
                    {step.input}
                  </code>
                )}
                {step.sub_questions && (
                  <ul className="mt-2 space-y-1">
                    {step.sub_questions.map((sq) => (
                      <li key={sq} className="flex items-start gap-1.5 text-[12px] text-hcl-navy-400 dark:text-slate-500">
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
      isWarning ? 'border-amber-200 bg-amber-50/60 dark:border-amber-900 dark:bg-amber-950/30' : 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900 dark:bg-emerald-950/30'
    }`}>
      <div className="px-4 py-3">
        <div className="flex items-center gap-2 mb-1">
          {isWarning ? (
            <AlertTriangle className="w-4 h-4 text-amber-600" />
          ) : (
            <Shield className="w-4 h-4 text-emerald-600" />
          )}
          <h2 className={`text-[13px] font-bold uppercase tracking-wide ${
            isWarning ? 'text-amber-700 dark:text-amber-300' : 'text-emerald-700 dark:text-emerald-300'
          }`}>
            {report.has_conflicts ? 'Conflicts detected' : 'Sources agree'}
          </h2>
        </div>
        <p className="text-[13px] text-hcl-navy-500 leading-relaxed dark:text-slate-400">{report.summary}</p>
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
                  <li key={`${conflict.source_a}-${index}`} className="border border-amber-200 rounded-lg bg-white/80 p-3 dark:border-slate-700 dark:bg-slate-900/80">
                    <p className="text-[13px] text-hcl-navy-600 mb-1 dark:text-slate-300">{conflict.claim_a}</p>
                    <a href={conflict.source_a} target="_blank" rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] font-bold text-hcl-blue-500 hover:text-hcl-blue-700 mr-3">
                      <Globe className="w-3 h-3" /> Source A
                    </a>
                    <p className="text-[13px] text-hcl-navy-600 mt-2 mb-1 dark:text-slate-300">{conflict.claim_b}</p>
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
    <div className="mt-4 border-t border-hcl-blue-100 pt-4 animate-fade-in dark:border-slate-800">
      <div className="flex items-center gap-2 mb-3">
        <BookOpen className="w-4 h-4 text-hcl-blue-500" />
        <h2 className="text-[12px] font-bold text-hcl-navy-400 uppercase tracking-wide dark:text-slate-400">Sources</h2>
        <span className="text-[11px] font-semibold text-hcl-blue-500 bg-hcl-blue-50 rounded-full px-2 py-0.5 dark:bg-slate-800 dark:text-slate-300">
          {citations.length}
        </span>
      </div>
      <ul className="space-y-2">
        {citations.map((source) => (
          <li key={source.url} className="border border-hcl-blue-100 rounded-xl bg-white p-3 hover:border-hcl-blue-200 hover:shadow-hcl transition-all duration-200 dark:border-slate-800 dark:bg-slate-900/70">
            <a href={source.url} target="_blank" rel="noreferrer"
              className="block text-[13px] font-bold text-hcl-blue-600 hover:text-hcl-blue-800 no-underline transition-colors dark:text-hcl-blue-300">
              {source.title}
            </a>
            <span className="block mt-0.5 text-[11px] text-hcl-navy-300 dark:text-slate-500">{freshnessLabel(source)}</span>
            {source.snippet && <p className="mt-1.5 text-[12px] text-hcl-navy-400 leading-relaxed dark:text-slate-400">{source.snippet}</p>}
          </li>
        ))}
      </ul>
    </div>
  )
}

function App() {
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
    const stored = loadStoredSessions()
    return stored.length > 0 ? stored : [createSession('New chat', [createWelcomeMessage()])]
  })
  const [activeSessionId, setActiveSessionId] = useState<string>(() => {
    const stored = loadStoredSessions()
    return stored[0]?.id ?? crypto.randomUUID()
  })
  const [messages, setMessages] = useState<Message[]>(() => {
    const stored = loadStoredSessions()
    return stored[0]?.messages ?? [createWelcomeMessage()]
  })
  const [query, setQuery] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState('')
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem('ai-query-agent-theme') === 'dark' || window.matchMedia('(prefers-color-scheme: dark)').matches
  })
  const [showSidebar, setShowSidebar] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode)
    window.localStorage.setItem('ai-query-agent-theme', darkMode ? 'dark' : 'light')
  }, [darkMode])

  useEffect(() => {
    window.localStorage.setItem('ai-query-agent-sessions', JSON.stringify(sessions))
  }, [sessions])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  function updateActiveSessionMessages(nextMessages: Message[], title?: string) {
    if (!activeSessionId) {
      return
    }

    setSessions((current) =>
      current.map((session) =>
        session.id === activeSessionId
          ? {
              ...session,
              title: title ?? session.title,
              updatedAt: new Date().toISOString(),
              messages: nextMessages,
            }
          : session,
      ),
    )
  }

  function selectSession(sessionId: string) {
    const session = sessions.find((item) => item.id === sessionId)
    if (!session) {
      return
    }
    setActiveSessionId(sessionId)
    setMessages(session.messages)
    setShowSidebar(false)
  }

  function startNewChat() {
    const freshSession = createSession('New chat', [createWelcomeMessage()])
    setSessions((current) => [freshSession, ...current])
    setActiveSessionId(freshSession.id)
    setMessages(freshSession.messages)
    setQuery('')
    setError('')
    setShowSidebar(false)
  }

  async function submitQuery(rawQuery: string) {
    const trimmed = rawQuery.trim()
    if (!trimmed || isStreaming) return

    const sessionIdToUse = activeSessionId ?? sessions[0]?.id ?? crypto.randomUUID()
    if (!activeSessionId) {
      setActiveSessionId(sessionIdToUse)
    }

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

    const nextMessages = [...messages, userMessage, assistantMessage]
    setMessages(nextMessages)
    updateActiveSessionMessages(nextMessages, trimmed.length > 40 ? `${trimmed.slice(0, 37)}...` : trimmed)
    setQuery('')
    setError('')
    setIsStreaming(true)

    const controller = new AbortController()
    abortRef.current = controller

    try {
      const response = await fetch(chatUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: trimmed, session_id: sessionIdToUse }),
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
            setMessages((current) => {
              const updated = current.map((message) =>
                message.id === assistantId
                  ? {
                      ...message,
                      content: message.content + payload.token,
                      status: 'Answering',
                    }
                  : message,
              )
              updateActiveSessionMessages(updated)
              return updated
            })
          }

          if (item.event === 'tool_call') {
            setMessages((current) => {
              const updated = current.map((message) =>
                message.id === assistantId
                  ? {
                      ...message,
                      status: payload.message,
                      sources: payload.sources ?? message.sources,
                      reasoning: [...(message.reasoning ?? []), payload],
                    }
                  : message,
              )
              updateActiveSessionMessages(updated)
              return updated
            })
          }

          if (item.event === 'confidence') {
            setMessages((current) => {
              const updated = current.map((message) =>
                message.id === assistantId ? { ...message, confidence: payload } : message,
              )
              updateActiveSessionMessages(updated)
              return updated
            })
          }

          if (item.event === 'contradictions') {
            setMessages((current) => {
              const updated = current.map((message) =>
                message.id === assistantId ? { ...message, contradictions: payload } : message,
              )
              updateActiveSessionMessages(updated)
              return updated
            })
          }

          if (item.event === 'followups') {
            setMessages((current) => {
              const updated = current.map((message) =>
                message.id === assistantId ? { ...message, followups: payload.questions ?? [] } : message,
              )
              updateActiveSessionMessages(updated)
              return updated
            })
          }

          if (item.event === 'done') {
            setMessages((current) => {
              const updated = current.map((message) =>
                message.id === assistantId
                  ? {
                      ...message,
                      status: undefined,
                      sources: payload.sources ?? message.sources,
                      citations: payload.citations ?? [],
                      confidence: payload.confidence ?? message.confidence,
                      contradictions: payload.contradictions ?? message.contradictions,
                      followups: payload.followups ?? message.followups,
                      complete: true,
                    }
                  : message,
              )
              updateActiveSessionMessages(updated)
              return updated
            })
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
        setMessages((current) => {
          const updated = current.map((item) =>
            item.id === assistantId
              ? {
                  ...item,
                  content: item.content || message,
                  status: undefined,
                  complete: true,
                }
              : item,
          )
          updateActiveSessionMessages(updated)
          return updated
        })
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
    const freshSession = createSession('New chat', [createWelcomeMessage()])
    setSessions([freshSession, ...sessions.filter((session) => session.id !== freshSession.id)])
    setActiveSessionId(freshSession.id)
    setMessages(freshSession.messages)
    setQuery('')
    setError('')
    setShowSidebar(false)
  }

  return (
    <main className="h-screen w-screen gradient-hcl-mesh" >
      <section className="w-full h-full flex bg-white dark:bg-slate-900 overflow-hidden">
        <aside className={`${showSidebar ? 'flex' : 'hidden'} lg:flex w-full lg:w-64 flex-col border-b lg:border-b-0 lg:border-r border-hcl-blue-100 bg-gradient-to-b from-hcl-blue-50/70 to-white p-4 dark:border-slate-800 dark:from-slate-900 dark:to-slate-950`}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-hcl-teal-600 dark:text-hcl-teal-400">History</p>
              <h2 className="text-sm font-semibold text-hcl-navy-500 dark:text-slate-200">Recent conversations</h2>
            </div>
            <button
              type="button"
              onClick={startNewChat}
              className="rounded-lg border border-hcl-blue-200 bg-white px-2.5 py-2 text-[12px] font-semibold text-hcl-blue-600 hover:bg-hcl-blue-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              + New
            </button>
          </div>

          <div className="flex-1 overflow-y-auto space-y-2 pr-1 scrollbar-hcl">
            {sessions.map((session) => (
              <button
                key={session.id}
                type="button"
                onClick={() => selectSession(session.id)}
                className={`w-full rounded-xl border px-3 py-3 text-left transition-all ${
                  activeSessionId === session.id
                    ? 'border-hcl-blue-300 bg-hcl-blue-50 shadow-sm dark:border-hcl-blue-600 dark:bg-slate-800'
                    : 'border-transparent bg-white/70 hover:border-hcl-blue-200 hover:bg-hcl-blue-50/70 dark:bg-slate-900/70 dark:hover:border-slate-700 dark:hover:bg-slate-800'
                }`}
              >
                <p className="text-[13px] font-semibold text-hcl-navy-600 truncate dark:text-slate-200">{session.title}</p>
                <p className="mt-1 text-[11px] text-hcl-navy-300 dark:text-slate-500">
                  {new Date(session.updatedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </p>
              </button>
            ))}
          </div>
        </aside>

        <div className="flex min-h-[480px] flex-1 flex-col">
          <header className="flex flex-wrap items-center justify-between gap-3 border-b border-hcl-blue-100 bg-gradient-to-r from-hcl-blue-50/50 to-transparent px-4 py-4 sm:px-6 dark:border-slate-800 dark:from-slate-900/70 dark:to-slate-950">
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="rounded-lg border border-hcl-blue-200 bg-white p-2 text-hcl-blue-600 lg:hidden dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                onClick={() => setShowSidebar((current) => !current)}
              >
                <MessageSquare className="w-4 h-4" />
              </button>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <Sparkles className="w-4 h-4 text-hcl-teal-500" />
                  <p className="text-[12px] font-bold text-hcl-teal-600 uppercase tracking-widest dark:text-hcl-teal-400">
                    Real-Time AI Query Agent
                  </p>
                </div>
                <h1 className="text-lg font-bold text-hcl-navy-500 leading-tight dark:text-slate-100">
                  Grounded answers with feedback loops
                </h1>
              </div>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              <button
                type="button"
                onClick={() => setDarkMode((current) => !current)}
                className="flex items-center gap-1.5 rounded-lg border border-hcl-blue-200 bg-white px-3 py-2 text-[13px] font-semibold text-hcl-navy-400 hover:bg-hcl-blue-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                {darkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                {darkMode ? 'Light' : 'Dark'}
              </button>
              <button
                type="button"
                onClick={resetChat}
                className="flex items-center gap-1.5 rounded-lg border border-hcl-blue-200 bg-white px-3 py-2 text-[13px] font-semibold text-hcl-navy-400 hover:bg-hcl-blue-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                New chat
              </button>
              <div className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-[13px] font-bold border transition-all duration-300 ${
                isStreaming
                  ? 'text-hcl-teal-700 border-hcl-teal-300 bg-hcl-teal-50 dark:border-hcl-teal-700 dark:bg-hcl-teal-950/30 dark:text-hcl-teal-300'
                  : 'text-hcl-navy-300 border-hcl-blue-100 bg-white dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
              }`}>
                <span className={`w-2 h-2 rounded-full transition-colors duration-300 ${
                  isStreaming ? 'bg-hcl-teal-500 animate-pulse' : 'bg-hcl-navy-200 dark:bg-slate-500'
                }`} />
                {isStreaming ? 'Live' : 'Ready'}
              </div>
            </div>
          </header>

          <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-6 space-y-4 sm:space-y-6 scrollbar-hcl" aria-live="polite">
            {messages.map((message) => (
              <article
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'} animate-slide-up`}
                key={message.id}
              >
                <div className={`w-fit max-w-[900px] rounded-2xl ${
                  message.role === 'user'
                    ? 'bg-gradient-to-br from-hcl-blue-500 to-hcl-blue-700 text-white shadow-hcl'
                    : 'bg-white border border-hcl-blue-100 shadow-hcl dark:bg-slate-900 dark:border-slate-800'
                }`}>
                  <div className="px-4 py-4 sm:px-5 sm:py-4">
                    {message.status && (
                      <div className="flex items-center gap-2 mb-3">
                        <Loader2 className="w-3.5 h-3.5 text-hcl-blue-500 animate-spin" />
                        <span className="text-[12px] font-bold text-hcl-blue-500">{message.status}</span>
                      </div>
                    )}

                    {message.reasoning && message.reasoning.length > 0 && (
                      <ReasoningPanel steps={message.reasoning} complete={message.complete} />
                    )}

                    <div className="text-[14px] leading-[1.65] whitespace-pre-wrap break-words">
                      {message.content ? (
                        <span className={message.role === 'user' ? 'text-white' : 'text-hcl-navy-600 dark:text-slate-300'}>
                          {renderAnswer(message.content)}
                        </span>
                      ) : !message.complete ? (
                        <div className="flex flex-col gap-2.5 py-2">
                          <div className="h-3.5 rounded-lg bg-gradient-to-r from-hcl-blue-100 via-hcl-blue-50 to-hcl-blue-100 bg-[length:200%_100%] animate-shimmer w-[85%]" />
                          <div className="h-3.5 rounded-lg bg-gradient-to-r from-hcl-blue-100 via-hcl-blue-50 to-hcl-blue-100 bg-[length:200%_100%] animate-shimmer w-[55%]" />
                        </div>
                      ) : null}
                    </div>

                    {!message.content && !message.complete && message.status === 'Answering' && <TypingIndicator />}

                    {message.confidence && <ConfidenceBadge confidence={message.confidence} />}

                    {message.contradictions && <ContradictionPanel report={message.contradictions} />}

                    {message.role === 'assistant' && message.complete && (message.citations?.length ?? 0) > 0 && (
                      <SourcesPanel citations={message.citations!} />
                    )}

                    {message.role === 'assistant' && message.complete && message.content && (
                      <div className="flex justify-end mt-4">
                        <button
                          type="button"
                          onClick={() => exportMarkdown(message)}
                          className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold text-hcl-navy-400 bg-hcl-blue-50 border border-hcl-blue-100 rounded-lg hover:bg-hcl-blue-100 hover:border-hcl-blue-200 transition-all duration-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                        >
                          <Download className="w-3.5 h-3.5" />
                          Export
                        </button>
                      </div>
                    )}

                    {message.followups && message.followups.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-4">
                        {message.followups.map((followup) => (
                          <button
                            type="button"
                            key={followup}
                            onClick={() => void submitQuery(followup)}
                            className="flex items-center gap-1.5 px-3 py-2 text-[12px] font-bold text-hcl-blue-600 bg-white border border-hcl-blue-200 rounded-xl hover:bg-hcl-blue-50 hover:border-hcl-blue-300 hover:shadow-hcl transition-all duration-200 text-left dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
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

          {error && (
            <div className="mx-4 mb-3 flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-[13px] font-semibold text-red-700 animate-fade-in sm:mx-6 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          <form className="px-4 pb-4 pt-3 sm:px-6 sm:pb-6" onSubmit={sendMessage}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
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
                  className="w-full resize-none border border-hcl-blue-200 rounded-xl px-4 py-3 text-[14px] text-hcl-navy-600 bg-white placeholder:text-hcl-navy-300 leading-relaxed focus:outline-none focus:ring-2 focus:ring-hcl-blue-500/20 focus:border-hcl-blue-400 transition-all duration-200 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:placeholder:text-slate-500"
                />
              </div>
              {isStreaming ? (
                <button
                  type="button"
                  onClick={stopStreaming}
                  className="flex items-center justify-center gap-2 px-5 py-3 bg-red-600 text-white rounded-xl text-[14px] font-bold hover:bg-red-700 transition-colors shrink-0"
                >
                  <Square className="w-4 h-4" />
                  Stop
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!query.trim()}
                  className="flex items-center justify-center gap-2 px-5 py-3 gradient-hcl text-white rounded-xl text-[14px] font-bold hover:shadow-hcl-lg disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 shrink-0"
                >
                  <Send className="w-4 h-4" />
                  Send
                </button>
              )}
            </div>
          </form>
        </div>
      </section>
    </main>
  )
}

export default App
