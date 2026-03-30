export enum BusinessType {
  Fashion = 'fashion',
  Beauty = 'beauty',
  Barber = 'barber',
}

export enum UserRole {
  Owner = 'owner',
  Manager = 'manager',
  Admin = 'admin',
  Superadmin = 'superadmin',
}

export enum ConnectionType {
  Instagram = 'instagram',
  KeyCrm = 'keycrm',
  SalesDrive = 'salesdrive',
  Shopify = 'shopify',
  WooCommerce = 'woocommerce',
  GoogleSheets = 'google_sheets',
}

export enum ConnectionStatus {
  Connected = 'connected',
  Disconnected = 'disconnected',
  Error = 'error',
  Pending = 'pending',
}

export enum SyncType {
  Catalog = 'catalog',
  Stock = 'stock',
  Customers = 'customers',
  Slots = 'slots',
}

export enum SyncMode {
  Full = 'full',
  Incremental = 'incremental',
  FileImport = 'file_import',
}

export enum SyncJobStatus {
  Queued = 'queued',
  Running = 'running',
  Success = 'success',
  Failed = 'failed',
}

export enum ProductStatus {
  Active = 'active',
  Archived = 'archived',
  Draft = 'draft',
}

export enum ConversationStatus {
  Active = 'active',
  HumanInControl = 'human_in_control',
  WaitingCustomer = 'waiting_customer',
  Closed = 'closed',
}

export enum ConversationStateStatus {
  Browsing = 'browsing',
  ProductSelected = 'product_selected',
  StockConfirmed = 'stock_confirmed',
  CollectingCustomerInfo = 'collecting_customer_info',
  AwaitingManagerConfirmation = 'awaiting_manager_confirmation',
  Closed = 'closed',
}

export enum MessageDirection {
  Inbound = 'inbound',
  Outbound = 'outbound',
}

export enum MessageRole {
  User = 'user',
  Assistant = 'assistant',
  Manager = 'manager',
  System = 'system',
}

export enum ReservationStatus {
  Active = 'active',
  Expired = 'expired',
  Cancelled = 'cancelled',
  Converted = 'converted',
}

export enum CheckoutSessionStatus {
  CollectingCustomerInfo = 'collecting_customer_info',
  ReadyForDraftOrder = 'ready_for_draft_order',
  DraftCreated = 'draft_created',
  Cancelled = 'cancelled',
  Expired = 'expired',
}

export enum OrderStatus {
  Draft = 'draft',
  AwaitingManagerConfirmation = 'awaiting_manager_confirmation',
  Confirmed = 'confirmed',
  Shipped = 'shipped',
  Delivered = 'delivered',
  Cancelled = 'cancelled',
}

export enum AuditLogType {
  AvailabilityCheck = 'availability_check',
  AiDecision = 'ai_decision',
  Handoff = 'handoff',
  ReservationCreated = 'reservation_created',
  DraftOrderCreated = 'draft_order_created',
  SyncEvent = 'sync_event',
}

export enum AuditLogStatus {
  Success = 'success',
  Failed = 'failed',
  Warning = 'warning',
}

export enum ReplyDecision {
  Reply = 'reply',
  AskFollowup = 'ask_followup',
  Handoff = 'handoff',
  CreateDraftOrder = 'create_draft_order',
  Noop = 'noop',
}
