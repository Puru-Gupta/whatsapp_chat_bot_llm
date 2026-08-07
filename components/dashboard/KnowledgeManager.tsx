"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlignLeft,
  ArrowLeft,
  ExternalLink,
  FileText,
  Globe2,
  Loader2,
  Power,
  RefreshCw,
  Trash2,
  UploadCloud,
} from "lucide-react";
import type { KnowledgeSource } from "@/types";

type SourceMode = "text" | "file" | "website";

interface ApiPayload {
  error?: string;
  pages_indexed?: number;
  chunks_created?: number;
  source?: KnowledgeSource;
  [key: string]: unknown;
}

const SOURCE_MODES: Array<{
  value: SourceMode;
  label: string;
  icon: typeof FileText;
}> = [
  { value: "text", label: "Paste text", icon: AlignLeft },
  { value: "file", label: "Upload file", icon: FileText },
  { value: "website", label: "Website", icon: Globe2 },
];

export default function KnowledgeManager() {
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [title, setTitle] = useState("");
  const [manualText, setManualText] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [websiteMode, setWebsiteMode] = useState<"page" | "site">("site");
  const [mode, setMode] = useState<SourceMode>("text");
  const fileRef = useRef<HTMLInputElement>(null);

  async function loadSources() {
    try {
      const response = await fetch("/api/knowledge");
      const data = await readJson(response);
      if (!response.ok) {
        throw new Error(asPayload(data).error ?? "Could not load sources.");
      }
      if (!Array.isArray(data)) throw new Error("Invalid source list response.");
      setSources(data as KnowledgeSource[]);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Could not load sources."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSources();
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setUploading(true);

    try {
      let response: Response;

      if (mode === "website") {
        if (!websiteUrl.trim()) throw new Error("Enter a website URL.");
        response = await fetch("/api/knowledge/website", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: title.trim(),
            url: websiteUrl.trim(),
            mode: websiteMode,
          }),
        });
      } else {
        const form = new FormData();
        form.append("title", title.trim());

        if (mode === "file") {
          const file = fileRef.current?.files?.[0];
          if (!file) throw new Error("Choose a file.");
          form.append("file", file);
        } else {
          if (!manualText.trim()) throw new Error("Paste some text.");
          form.append("manual_text", manualText.trim());
          form.append("source_type", "manual");
        }

        response = await fetch("/api/knowledge/upload", {
          method: "POST",
          body: form,
        });
      }

      const data = asPayload(await readJson(response));
      if (!response.ok) throw new Error(data.error ?? "Import failed.");

      const pageSummary =
        mode === "website" ? ` ${data.pages_indexed} pages indexed.` : "";
      setSuccess(
        `${title.trim()} added with ${data.chunks_created} knowledge chunks.${pageSummary}`
      );
      setTitle("");
      setManualText("");
      setWebsiteUrl("");
      if (fileRef.current) fileRef.current.value = "";
      await loadSources();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Import failed."
      );
    } finally {
      setUploading(false);
    }
  }

  async function toggleStatus(source: KnowledgeSource) {
    if (source.status !== "active" && source.status !== "inactive") return;
    const newStatus = source.status === "active" ? "inactive" : "active";

    try {
      const response = await fetch(`/api/knowledge/${source.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = asPayload(await readJson(response));
      if (!response.ok) throw new Error(data.error ?? "Status update failed.");
      setSources((current) =>
        current.map((item) =>
          item.id === source.id ? { ...item, status: newStatus } : item
        )
      );
    } catch (statusError) {
      setError(
        statusError instanceof Error ? statusError.message : "Status update failed."
      );
    }
  }

  async function deleteSource(id: string) {
    if (!confirm("Delete this source and all of its knowledge chunks?")) return;

    const response = await fetch(`/api/knowledge/${id}`, { method: "DELETE" });
    if (response.ok) {
      setSources((current) => current.filter((source) => source.id !== id));
      return;
    }

    const data = asPayload(await readJson(response));
    setError(data.error ?? "Delete failed.");
  }

  async function reprocess(id: string) {
    setError("");
    setSources((current) =>
      current.map((source) =>
        source.id === id ? { ...source, status: "processing" } : source
      )
    );

    const response = await fetch(`/api/knowledge/${id}/reprocess`, {
      method: "POST",
    });
    const data = asPayload(await readJson(response));

    if (response.ok) {
      if (!data.source) {
        setError("Reprocessing returned an invalid response.");
        await loadSources();
        return;
      }
      setSources((current) =>
        current.map((source) => (source.id === id ? data.source! : source))
      );
    } else {
      setError(data.error ?? "Reprocessing failed.");
      await loadSources();
    }
  }

  const statusColor: Record<string, string> = {
    active: "bg-emerald-100 text-emerald-800",
    inactive: "bg-slate-100 text-slate-600",
    processing: "bg-sky-100 text-sky-700",
    error: "bg-red-100 text-red-700",
  };

  const submitLabel =
    mode === "website"
      ? "Import website"
      : mode === "file"
        ? "Import file"
        : "Add text";

  return (
    <div className="min-h-screen bg-[#f4f6f1] text-slate-950">
      <nav className="flex items-center bg-[#075E54] px-4 py-3 text-white sm:px-6">
        <a
          href="/dashboard"
          className="inline-flex items-center gap-2 rounded-md px-2 py-1 text-sm transition hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-white/50"
        >
          <ArrowLeft className="h-4 w-4" />
          Conversations
        </a>
        <span className="mx-3 text-emerald-200">/</span>
        <span className="font-semibold">Knowledge base</span>
      </nav>

      <main className="mx-auto max-w-5xl space-y-8 px-4 py-8">
        <section className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
              <UploadCloud className="h-5 w-5" />
            </div>
            <h1 className="text-lg font-semibold">Add knowledge source</h1>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="source-title" className="mb-1 block text-sm font-medium text-slate-700">
                Title
              </label>
              <input
                id="source-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
                maxLength={160}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
                placeholder="AQLI website"
              />
            </div>

            <div>
              <div className="grid grid-cols-3 gap-1 rounded-md bg-slate-100 p-1" role="tablist" aria-label="Source format">
                {SOURCE_MODES.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.value}
                      type="button"
                      role="tab"
                      aria-selected={mode === item.value}
                      onClick={() => setMode(item.value)}
                      className={`inline-flex min-h-9 items-center justify-center gap-2 rounded-md px-2 text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                        mode === item.value
                          ? "bg-white text-emerald-800 shadow-sm"
                          : "text-slate-600 hover:text-slate-950"
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      <span className="hidden sm:inline">{item.label}</span>
                    </button>
                  );
                })}
              </div>

              <div className="mt-3">
                {mode === "text" && (
                  <textarea
                    value={manualText}
                    onChange={(event) => setManualText(event.target.value)}
                    rows={7}
                    className="w-full resize-y rounded-md border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
                    placeholder="Paste FAQ, policy, report notes, or other reference text"
                  />
                )}

                {mode === "file" && (
                  <div className="rounded-lg border-2 border-dashed border-slate-300 p-7 text-center transition hover:border-emerald-400 hover:bg-emerald-50/30">
                    <input
                      ref={fileRef}
                      type="file"
                      accept=".pdf,.txt,.md,.docx,.csv"
                      className="hidden"
                      id="file-upload"
                    />
                    <label
                      htmlFor="file-upload"
                      className="inline-flex cursor-pointer items-center gap-2 text-sm font-medium text-emerald-700 hover:text-emerald-900"
                    >
                      <FileText className="h-4 w-4" />
                      Choose PDF, DOCX, CSV, TXT, or Markdown
                    </label>
                  </div>
                )}

                {mode === "website" && (
                  <div className="space-y-3">
                    <label htmlFor="website-url" className="sr-only">
                      Website URL
                    </label>
                    <div className="relative">
                      <Globe2 className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                      <input
                        id="website-url"
                        type="url"
                        inputMode="url"
                        value={websiteUrl}
                        onChange={(event) => setWebsiteUrl(event.target.value)}
                        className="w-full rounded-md border border-slate-300 py-2 pl-9 pr-3 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
                        placeholder="https://aqli.epic.uchicago.edu"
                      />
                    </div>
                    <div className="inline-flex rounded-md border border-slate-200 bg-white p-1" role="group" aria-label="Website import scope">
                      {(["page", "site"] as const).map((value) => (
                        <button
                          key={value}
                          type="button"
                          aria-pressed={websiteMode === value}
                          onClick={() => setWebsiteMode(value)}
                          className={`rounded px-3 py-1.5 text-xs font-medium transition focus:outline-none focus:ring-2 focus:ring-emerald-500 ${
                            websiteMode === value
                              ? "bg-emerald-100 text-emerald-900"
                              : "text-slate-600 hover:text-slate-950"
                          }`}
                        >
                          {value === "page" ? "This page" : "Entire site"}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {error && (
              <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}
            {success && (
              <p role="status" className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
                {success}
              </p>
            )}

            <button
              type="submit"
              disabled={uploading}
              className="inline-flex min-h-10 items-center gap-2 rounded-md bg-[#128C7E] px-5 py-2 text-sm font-medium text-white transition hover:bg-[#075E54] focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {uploading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : mode === "website" ? (
                <Globe2 className="h-4 w-4" />
              ) : (
                <UploadCloud className="h-4 w-4" />
              )}
              {uploading ? "Processing..." : submitLabel}
            </button>
          </form>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">Knowledge sources</h2>

          {loading && <p className="text-sm text-slate-500">Loading...</p>}

          {!loading && sources.length === 0 && (
            <div className="rounded-lg border border-dashed border-slate-300 bg-white p-10 text-center">
              <FileText className="mx-auto mb-3 h-8 w-8 text-slate-300" />
              <p className="text-sm text-slate-500">No knowledge sources yet.</p>
            </div>
          )}

          <div className="space-y-2">
            {sources.map((source) => (
              <article
                key={source.id}
                className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 bg-white px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">{source.title}</span>
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] uppercase text-slate-500">
                      {source.file_path?.toLowerCase().endsWith(".csv")
                        ? "csv"
                        : source.source_type}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ${statusColor[source.status] ?? statusColor.inactive}`}>
                      {source.status}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                    <span>{source.chunk_count} chunks</span>
                    <span>{new Date(source.created_at).toLocaleDateString()}</span>
                    {source.source_url && (
                      <a
                        href={source.source_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex max-w-full items-center gap-1 truncate text-emerald-700 hover:text-emerald-900"
                      >
                        <span className="truncate">{new URL(source.source_url).hostname}</span>
                        <ExternalLink className="h-3 w-3 flex-none" />
                      </a>
                    )}
                  </div>
                </div>

                <div className="flex flex-none items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggleStatus(source)}
                    disabled={source.status === "processing" || source.status === "error"}
                    title={source.status === "active" ? "Deactivate" : "Activate"}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-600 transition hover:text-slate-950 focus:outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-40"
                  >
                    <Power className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => reprocess(source.id)}
                    disabled={source.status === "processing" || source.chunk_count === 0}
                    title="Reprocess"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-sky-200 text-sky-700 transition hover:text-sky-900 focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-40"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteSource(source.id)}
                    title="Delete"
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-red-200 text-red-700 transition hover:text-red-900 focus:outline-none focus:ring-2 focus:ring-red-500"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function asPayload(value: unknown): ApiPayload {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as ApiPayload)
    : {};
}
