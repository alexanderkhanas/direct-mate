export interface User {
  id: string;
  email: string;
  role: 'owner' | 'manager' | 'admin' | 'superadmin';
  tenantId: string;
}

export interface Conversation {
  id: string;
  customerName: string | null;
  channel: string;
  status: 'active' | 'human_in_control' | 'waiting_customer' | 'closed';
  needsHandoff: boolean;
  lastMessageAt: string | null;
  customer?: {
    id: string;
    externalUserId: string;
    username: string | null;
    fullName: string | null;
  };
}

export interface ConversationDetail extends Conversation {
  customer: {
    id: string;
    externalUserId: string;
    username: string | null;
    fullName: string | null;
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
  sku: string | null;
  size: string | null;
  color: string | null;
  price: number;
  currency: string;
  imageUrl: string | null;
  effectiveAvailable: number;
  lastSyncedAt: string | null;
}

export interface ProductRow {
  id: string;
  sku: string | null;
  title: string;
  category: string | null;
  imageUrl: string | null;
  variantCount: number;
  updatedAt: string;
  variants: ProductVariantRow[];
}

export interface Order {
  id: string;
  tenantId: string;
  status: string;
  totalAmount: number | null;
  currency: string;
  source: string;
  externalOrderId: string | null;
  externalSyncStatus: string;
  externalOrderMetadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  customer: {
    fullName: string | null;
    phone: string | null;
    city: string | null;
    branch: string | null;
  } | null;
  items: OrderItem[];
}

export interface OrderItem {
  id: string;
  productId: string;
  variantId: string;
  qty: number;
  unitPrice: number;
  currency: string;
  productTitle: string | null;
  variantTitle: string | null;
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

export interface ScreenshotImportJob {
  id: string;
  status: string;
  totalFiles: number;
  processedFiles: number;
  createdAt: string;
  completedAt: string | null;
}

export interface ScreenshotImportFile {
  id: string;
  fileName: string;
  fileUrl: string;
  mimeType: string;
  ocrStatus: string;
  extractionStatus: string;
}

export interface TranscriptTurn {
  speaker: 'manager' | 'customer';
  text: string;
}

export interface ExtractedFragment {
  id: string;
  transcriptJson: TranscriptTurn[];
  scenarioSuggestion: string | null;
  confidenceScore: number;
  reviewStatus: string;
  createdAt: string;
  file?: ScreenshotImportFile;
  phrases?: ExtractedPhrase[];
  voiceSignals?: ExtractedVoiceSignal[];
}

export interface ExtractedPhrase {
  id: string;
  phrase: string;
  phraseType: string;
  scenario: string | null;
  confidenceScore: number;
  approvalStatus: string;
}

export interface ExtractedVoiceSignal {
  id: string;
  signalType: string;
  signalValue: string;
  evidenceText: string | null;
  confidenceScore: number;
  approvalStatus: string;
}

export interface ResponseTemplate {
  id: string;
  scenario: string;
  stage: string | null;
  blocks: string[];
  requiredVariables: string[];
  toneTags: string[];
  priority: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PhraseBlock {
  id: string;
  type: string;
  text: string;
  scenarioTags: string[];
  active: boolean;
  createdAt: string;
}

export interface FaqItem {
  id: string;
  questionTags: string[];
  answerTemplate: string;
  active: boolean;
  createdAt: string;
}

// ─── Testing ──────────────────────────────────────────────────────

export interface TestRun {
  id: string;
  status: 'running' | 'completed' | 'failed';
  totalScenarios: number;
  passedScenarios: number;
  failedScenarios: number;
  startedAt: string;
  completedAt: string | null;
  scenarios?: TestRunScenario[];
}

export interface TestRunScenario {
  id: string;
  scenarioName: string;
  scenarioFile: string;
  status: 'pending' | 'running' | 'passed' | 'failed';
  reviewStatus: 'pending' | 'approved' | 'needs_fix';
  reviewComment: string | null;
  steps: TestStep[];
  durationMs: number | null;
  errorMessage: string | null;
}

export interface TestStep {
  stepIndex: number;
  customerMessage: string;
  botReply: string | null;
  scenario: string | null;
  templateId: string | null;
  memory: Record<string, unknown>;
  assertions: TestAssertion[];
  passed: boolean;
  failReason?: string;
}

export interface TestAssertion {
  type: string;
  expected: unknown;
  actual: unknown;
  passed: boolean;
}
