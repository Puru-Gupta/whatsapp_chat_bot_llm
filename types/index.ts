export interface Conversation {
  id: string;
  phone: string;
  name: string | null;
  mode: "agent" | "human";
  last_message: string | null;
  unread_count: number;
  updated_at: string;
  created_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: "user" | "assistant" | "human" | "system";
  content: string;
  whatsapp_msg_id: string | null;
  source: string;
  created_at: string;
}

export interface KnowledgeSource {
  id: string;
  title: string;
  source_type: "pdf" | "doc" | "txt" | "manual" | "website" | "faq";
  source_url: string | null;
  file_path: string | null;
  chunk_count: number;
  status: "active" | "inactive" | "processing" | "error";
  created_at: string;
  updated_at: string;
}

export interface KnowledgeChunk {
  id: string;
  source_id: string;
  chunk_index: number;
  content: string;
  metadata: Record<string, unknown>;
  similarity?: number;
}

export interface WhatsAppWebhookPayload {
  object: string;
  entry: WebhookEntry[];
}

export interface WebhookEntry {
  id: string;
  changes: WebhookChange[];
}

export interface WebhookChange {
  value: WebhookValue;
  field: string;
}

export interface WebhookValue {
  messaging_product: string;
  metadata: {
    display_phone_number: string;
    phone_number_id: string;
  };
  contacts?: WebhookContact[];
  messages?: WebhookMessage[];
  statuses?: WebhookStatus[];
}

export interface WebhookContact {
  profile: { name: string };
  wa_id: string;
}

export interface WebhookMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
}

export interface WebhookStatus {
  id: string;
  status: string;
  timestamp: string;
  recipient_id: string;
}
