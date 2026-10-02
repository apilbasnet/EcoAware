'use client'
import { useState, useEffect, useRef } from 'react'
import { GoogleGenAI } from '@google/genai'
import { Send, Loader2, Leaf, Sparkles } from 'lucide-react'
import ReactMarkdown from 'react-markdown'

type Message = {
  role: 'user' | 'assistant'
  content: string
}

const SYSTEM_INSTRUCTION = `You are EcoBot, the AI assistant inside EcoAware — a community waste-reporting and recycling rewards app.

Your job:
- Help users with waste management, recycling, sorting waste correctly, and reducing environmental impact
- Explain how to identify waste types (plastic, paper, glass, metal, organic) and how to dispose of or recycle them properly
- Help users understand how the EcoAware app works: reporting waste, earning points, collection tasks, and the leaderboard
- Give practical, local-friendly advice on reducing, reusing, and recycling

Tone: friendly, encouraging, concise. You're not a generic AI — you're EcoAware's dedicated waste and recycling guide.
If asked who you are, introduce yourself as EcoBot, EcoAware's assistant, not as Gemini or a generic AI model.`

const SUGGESTED_PROMPTS = [
  "How do I sort plastic vs. paper waste?",
  "How do reward points work in EcoAware?",
  "What can I do with old electronics?",
  "Tips to reduce household waste",
]

export default function MessagesPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Load saved chat history for this user
  useEffect(() => {
    const email = localStorage.getItem('userEmail')
    if (email) {
      const saved = sessionStorage.getItem(`ecobot_chat_${email}`)
      if (saved) {
        try {
          setMessages(JSON.parse(saved))
        } catch {
          // corrupted data, ignore
        }
      }
    }
  }, [])

  // Save chat history whenever messages change
  useEffect(() => {
    const email = localStorage.getItem('userEmail')
    if (email && messages.length > 0) {
      sessionStorage.setItem(`ecobot_chat_${email}`, JSON.stringify(messages))
    }
  }, [messages])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  const sendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return

    setIsLoading(true)
    setError('')

    const newMessage: Message = { role: 'user', content: text.trim() }
    const updatedMessages = [...messages, newMessage]
    setMessages(updatedMessages)
    setInput('')

    try {
      const API_KEY = process.env.NEXT_PUBLIC_GEMINI_API_KEY
      if (!API_KEY) throw new Error('API key is missing')

      const ai = new GoogleGenAI({ apiKey: API_KEY })

      const contents = updatedMessages.map(msg => ({
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: msg.content }],
      }))

      const result = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
        },
      })

      const responseText = result.text ?? "Sorry, I couldn't generate a response — try again?"

      setMessages(prev => [...prev, { role: 'assistant', content: responseText }])
    } catch (err) {
      console.error('Error:', err)
      setError(err instanceof Error ? err.message : 'An unknown error occurred')
    } finally {
      setIsLoading(false)
      inputRef.current?.focus()
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    sendMessage(input)
  }

  return (
    <div className="flex flex-col h-full min-h-0 flex-1 bg-gray-50">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 sm:px-6 py-4 border-b border-gray-200 bg-white shrink-0">
        <div className="flex items-center justify-center w-10 h-10 rounded-full bg-green-600 text-white shrink-0">
          <Leaf className="w-5 h-5" />
        </div>
        <div>
          <h1 className="font-semibold text-gray-800 leading-tight">EcoBot</h1>
          <p className="text-xs text-gray-500 leading-tight">Your waste management assistant</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-6 space-y-4">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center px-4">
            <div className="flex items-center justify-center w-14 h-14 rounded-full bg-green-100 text-green-600 mb-4">
              <Sparkles className="w-7 h-7" />
            </div>
            <h2 className="text-lg font-medium text-gray-800 mb-1">Hi, I'm EcoBot 🌱</h2>
            <p className="text-sm text-gray-500 max-w-sm mb-6">
              Ask me about sorting waste, recycling tips, or how points and rewards work in EcoAware.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-md">
              {SUGGESTED_PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => sendMessage(prompt)}
                  className="text-left text-sm px-3 py-2 rounded-xl border border-gray-200 bg-white hover:border-green-400 hover:bg-green-50 transition-colors text-gray-700"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, index) => (
          <div key={index} className={`flex items-end gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {msg.role === 'assistant' && (
              <div className="flex items-center justify-center w-7 h-7 rounded-full bg-green-600 text-white shrink-0 mb-0.5">
                <Leaf className="w-3.5 h-3.5" />
              </div>
            )}
            <div
              className={`max-w-[85%] sm:max-w-md md:max-w-lg rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-green-600 text-white rounded-br-sm'
                  : 'bg-white text-gray-800 border border-gray-200 rounded-bl-sm shadow-sm'
              }`}
            >
              {msg.role === 'assistant' ? (
                <div className="prose prose-sm max-w-none prose-p:my-1.5 prose-ol:my-1.5 prose-ul:my-1.5 [&_strong]:font-semibold">
                  <ReactMarkdown>{msg.content}</ReactMarkdown>
                </div>
              ) : (
                <p className="whitespace-pre-wrap">{msg.content}</p>
              )}
            </div>
          </div>
        ))}

        {isLoading && (
          <div className="flex items-end gap-2 justify-start">
            <div className="flex items-center justify-center w-7 h-7 rounded-full bg-green-600 text-white shrink-0">
              <Leaf className="w-3.5 h-3.5" />
            </div>
            <div className="bg-white border border-gray-200 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
              <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
            </div>
          </div>
        )}

        {error && (
          <p className="text-red-500 text-sm text-center bg-red-50 border border-red-200 rounded-lg py-2 px-3">
            {error}
          </p>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="shrink-0 p-3 sm:p-4 bg-white border-t border-gray-200">
        <div className="flex items-center gap-2 bg-gray-100 rounded-full px-2 py-1.5 focus-within:ring-2 focus-within:ring-green-500 transition-shadow">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask EcoBot about waste, recycling, or rewards..."
            className="flex-grow bg-transparent px-3 py-2 text-sm focus:outline-none disabled:opacity-50"
            disabled={isLoading}
          />
          <button
            type="submit"
            className="flex items-center justify-center w-9 h-9 rounded-full bg-green-600 text-white hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50 disabled:hover:bg-green-600 transition-colors shrink-0"
            disabled={isLoading || !input.trim()}
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </form>
    </div>
  )
}