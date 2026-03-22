export interface User {
  id: string;
  email: string;
  role: 'owner' | 'manager' | 'admin';
  tenantId: string;
}

export interface Conversation {
  id: string;
  customerName: string | null;
  channel: string;
  status: 'active' | 'human_in_control' | 'waiting_customer' | 'closed';
  needsHandoff: boolean;
  lastMessageAt: string | null;
}

export interface ConversationDetail extends Conversation {
  customer: {
    id: string;
    externalUserId: string;
    username: string | null;
  };
  messages: Message[];
  state: ConversationState | null;
}

export interface Message {
  id: string;
  direction: 'inbound' | 'outbound';
  role: 'user' | 'assistant' | 'manager' | 'system';
  text: string | null;
  createdAt: string;
}

export interface ConversationState {
  stateStatus: string;
  selectedProductId: string | null;
  selectedVariantId: string | null;
}

export interface Connection {
  id: string;
  type: string;
  status: 'connected' | 'disconnected' | 'error' | 'pending';
  externalAccountId: string | null;
  lastSyncAt: string | null;
  metadata: { accountName?: string } | null;
}

export interface ManagerExample {
  id: string;
  customerMessage: string;
  managerReply: string;
  tags: string[];
  isActive: boolean;
}

export interface ProductVariantRow {
  id: string;
  size: string | null;
  color: string | null;
  price: number;
  currency: string;
  effectiveAvailable: number;
  lastSyncedAt: string | null;
}

export interface ProductRow {
  id: string;
  title: string;
  category: string | null;
  variantCount: number;
  updatedAt: string;
  variants: ProductVariantRow[];
}

export interface Order {
  id: string;
  status: string;
  customerName?: string;
  totalAmount: number | null;
  currency: string;
  createdAt: string;
}

export interface TenantSettings {
  brandTonePrompt: string | null;
  supportedLanguages: string[];
  businessHours: {
    timezone: string;
    days: number[];
    start: string;
    end: string;
  } | null;
  handoffRules: {
    maxFailedTurns: number;
    stockFreshnessMinutes: number;
    negativeSentimentEscalation: boolean;
  } | null;
}

export interface AuditLog {
  id: string;
  type: string;
  status: string;
  details: Record<string, unknown> | null;
  createdAt: string;
}
