"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatDistanceToNow } from "date-fns";
import {
  Bot,
  Database,
  LogOut,
  MessageCircle,
  Search,
  SendHorizontal,
  UserRound,
} from "lucide-react";
import type { Conversation, Message } from "@/types";

type RealtimeInsertPayload<T> = {
  new: T;
};

export default function ConversationDashboard() {
  const supabase = createClient();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [search, setSearch] = useState("");
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const activeConv = conversations.find((c) => c.id === activeId);

  // ── Load conversations ───────────────────────────────────────────────────
  const loadConversations = useCallback(async () => {
    const res = await fetch(
      `/api/conversations?search=${encodeURIComponent(search)}`
    );
    if (res.ok) setConversations(await res.json());
  }, [search]);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // ── Load messages when active conversation changes ───────────────────────
  useEffect(() => {
    if (!activeId) return;
    setLoadingMessages(true);
    fetch(`/api/conversations/${activeId}/messages`)
      .then((r) => r.json())
      .then((data) => {
        setMessages(data);
        setLoadingMessages(false);
        // Reset unread count
        fetch(`/api/conversations/${activeId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ unread_count: 0 }),
        });
        setConversations((prev) =>
          prev.map((c) => (c.id === activeId ? { ...c, unread_count: 0 } : c))
        );
      });
  }, [activeId]);

  // ── Scroll to bottom ─────────────────────────────────────────────────────
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ── Realtime subscriptions ───────────────────────────────────────────────
  useEffect(() => {
    const msgSub = supabase
      .channel("messages-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload: RealtimeInsertPayload<Message>) => {
          const msg = payload.new as Message;
          if (msg.conversation_id === activeId) {
            setMessages((prev) => [...prev, msg]);
          }
          // Refresh sidebar
          loadConversations();
        }
      )
      .subscribe();

    const convSub = supabase
      .channel("conversations-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "conversations" },
        () => loadConversations()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(msgSub);
      supabase.removeChannel(convSub);
    };
  }, [activeId, loadConversations, supabase]);

  // ── Toggle agent / human mode ────────────────────────────────────────────
  async function toggleMode() {
    if (!activeId || !activeConv) return;
    const newMode = activeConv.mode === "agent" ? "human" : "agent";
    const res = await fetch(`/api/conversations/${activeId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: newMode }),
    });
    if (res.ok) {
      setConversations((prev) =>
        prev.map((c) => (c.id === activeId ? { ...c, mode: newMode } : c))
      );
    }
  }

  // ── Send manual message ──────────────────────────────────────────────────
  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!activeId || !input.trim()) return;
    setSending(true);
    const text = input.trim();
    setInput("");

    const res = await fetch(`/api/conversations/${activeId}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
    });

    if (res.ok) {
      const msg = await res.json();
      setMessages((prev) => [...prev, msg]);
    }
    setSending(false);
  }

  // ── Sign out ─────────────────────────────────────────────────────────────
  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = "/auth/login";
  }

  const filteredConvs = conversations.filter((c) => {
    const q = search.toLowerCase();
    return (
      c.phone.includes(q) || (c.name ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex h-dvh overflow-hidden bg-[#f4f6f1] text-slate-950">
      {/* ── Sidebar ──────────────────────────────────────────────────────── */}
      <aside className="w-80 flex-shrink-0 bg-white border-r border-slate-200 flex flex-col">
        {/* Sidebar header */}
        <div className="px-4 py-4 border-b border-emerald-900/20 bg-[#075E54] text-white">
          <div className="flex items-center justify-between mb-3">
            <span className="font-semibold text-sm tracking-wide">AQLI Chatbot</span>
            <div className="flex gap-2">
              <a
                href="/dashboard/knowledge"
                title="Knowledge base"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-white/10 text-white transition hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/50"
              >
                <Database className="h-4 w-4" />
              </a>
              <button
                onClick={signOut}
                title="Sign out"
                className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-white/10 text-white transition hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/50"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
          <label className="flex items-center gap-2 rounded-md bg-white/10 px-3 py-2 text-sm ring-1 ring-white/10 focus-within:ring-white/50">
            <Search className="h-4 w-4 text-emerald-100" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search conversations"
              className="w-full bg-transparent placeholder-emerald-100/70 text-white outline-none"
            />
          </label>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto">
          {filteredConvs.length === 0 && (
            <div className="px-6 py-12 text-center text-sm text-slate-400">
              <MessageCircle className="mx-auto mb-3 h-8 w-8 text-slate-300" />
              No conversations yet
            </div>
          )}
          {filteredConvs.map((conv) => (
            <button
              key={conv.id}
              onClick={() => setActiveId(conv.id)}
              className={`w-full text-left px-4 py-3 border-b border-slate-100 transition hover:bg-emerald-50/70 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-emerald-500 ${
                conv.id === activeId ? "bg-emerald-50" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-sm text-slate-950 truncate">
                      {conv.name ?? conv.phone}
                    </span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${
                        conv.mode === "agent"
                          ? "bg-green-100 text-green-700"
                          : "bg-orange-100 text-orange-700"
                      }`}
                    >
                      {conv.mode === "agent" ? "AI" : "Human"}
                    </span>
                  </div>
                  {conv.name && (
                    <p className="text-xs text-gray-400">{conv.phone}</p>
                  )}
                  <p className="text-xs text-slate-500 truncate mt-0.5">
                    {conv.last_message ?? "No messages yet"}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <span className="text-[10px] text-gray-400">
                    {formatDistanceToNow(new Date(conv.updated_at), {
                      addSuffix: false,
                    })}
                  </span>
                  {conv.unread_count > 0 && (
                    <span className="bg-green-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                      {conv.unread_count > 9 ? "9+" : conv.unread_count}
                    </span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      </aside>

      {/* ── Chat Panel ───────────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col min-w-0">
        {!activeConv ? (
          <div className="flex-1 flex items-center justify-center text-slate-400">
            <div className="text-center">
              <MessageCircle className="mx-auto mb-3 h-12 w-12 text-slate-300" />
              <p className="text-lg font-medium text-slate-700">Select a conversation</p>
              <p className="text-sm">Choose from the list on the left</p>
            </div>
          </div>
        ) : (
          <>
            {/* Chat header */}
            <div className="px-5 py-3 bg-white border-b border-slate-200 flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-slate-950">
                  {activeConv.name ?? activeConv.phone}
                </h2>
                {activeConv.name && (
                  <p className="text-xs text-gray-500">{activeConv.phone}</p>
                )}
              </div>
              <button
                onClick={toggleMode}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                  activeConv.mode === "agent"
                    ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                    : "bg-amber-100 text-amber-800 hover:bg-amber-200"
                }`}
              >
                {activeConv.mode === "agent" ? (
                  <Bot className="h-3.5 w-3.5" />
                ) : (
                  <UserRound className="h-3.5 w-3.5" />
                )}
                {activeConv.mode === "agent" ? "AI mode" : "Human mode"}
              </button>
            </div>

            {/* Messages */}
            <div
              className="flex-1 overflow-y-auto px-4 py-4 space-y-2"
              style={{ background: "#ECE5DD" }}
            >
              {loadingMessages && (
                <p className="text-center text-gray-400 text-sm">Loading…</p>
              )}
              {messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} />
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <form
              onSubmit={sendMessage}
              className="px-4 py-3 bg-white border-t border-slate-200 flex gap-2"
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Type a message"
                disabled={sending}
                className="flex-1 rounded-md border border-slate-300 px-4 py-2 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
              />
              <button
                type="submit"
                disabled={sending || !input.trim()}
                title="Send message"
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md bg-[#128C7E] text-white transition hover:bg-[#075E54] disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              >
                <SendHorizontal className="h-4 w-4" />
              </button>
            </form>
          </>
        )}
      </main>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const isHuman = message.role === "human";
  const isAI = message.role === "assistant";

  const bubbleClass = isUser
    ? "bg-white text-slate-900 self-start rounded-tr-lg rounded-br-lg rounded-bl-lg"
    : isHuman
    ? "bg-sky-600 text-white self-end rounded-tl-lg rounded-bl-lg rounded-br-lg"
    : isAI
    ? "bg-[#DCF8C6] text-slate-900 self-end rounded-tl-lg rounded-bl-lg rounded-br-lg"
    : "bg-slate-200 text-slate-600 self-center text-xs italic rounded-md";

  const label = isUser
    ? null
    : isHuman
    ? "You (Human)"
    : isAI
    ? "AI"
    : null;

  return (
    <div
      className={`flex max-w-[78%] flex-col sm:max-w-[42rem] ${
        isUser ? "items-start" : "items-end ml-auto"
      }`}
    >
      {label && (
        <span className="text-[10px] text-slate-500 mb-0.5 px-1">{label}</span>
      )}
      <div className={`px-3 py-2 shadow-sm ${bubbleClass}`}>
        <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>
        <p className={`text-[10px] mt-1 text-right ${isUser ? "text-slate-400" : isHuman ? "text-sky-100" : "text-slate-400"}`}>
          {new Date(message.created_at).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      </div>
    </div>
  );
}
