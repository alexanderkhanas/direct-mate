export declare enum BusinessType {
    Fashion = "fashion",
    Beauty = "beauty",
    Barber = "barber"
}
export declare enum UserRole {
    Owner = "owner",
    Manager = "manager",
    Admin = "admin"
}
export declare enum ConnectionType {
    Instagram = "instagram",
    KeyCrm = "keycrm",
    SalesDrive = "salesdrive",
    Shopify = "shopify",
    WooCommerce = "woocommerce",
    GoogleSheets = "google_sheets"
}
export declare enum ConnectionStatus {
    Connected = "connected",
    Disconnected = "disconnected",
    Error = "error",
    Pending = "pending"
}
export declare enum SyncType {
    Catalog = "catalog",
    Stock = "stock",
    Customers = "customers",
    Slots = "slots"
}
export declare enum SyncMode {
    Full = "full",
    Incremental = "incremental",
    FileImport = "file_import"
}
export declare enum SyncJobStatus {
    Queued = "queued",
    Running = "running",
    Success = "success",
    Failed = "failed"
}
export declare enum ProductStatus {
    Active = "active",
    Archived = "archived",
    Draft = "draft"
}
export declare enum ConversationStatus {
    Active = "active",
    HumanInControl = "human_in_control",
    WaitingCustomer = "waiting_customer",
    Closed = "closed"
}
export declare enum ConversationStateStatus {
    Browsing = "browsing",
    ProductSelected = "product_selected",
    StockConfirmed = "stock_confirmed",
    CollectingCustomerInfo = "collecting_customer_info",
    AwaitingManagerConfirmation = "awaiting_manager_confirmation",
    Closed = "closed"
}
export declare enum MessageDirection {
    Inbound = "inbound",
    Outbound = "outbound"
}
export declare enum MessageRole {
    User = "user",
    Assistant = "assistant",
    Manager = "manager",
    System = "system"
}
export declare enum ReservationStatus {
    Active = "active",
    Expired = "expired",
    Cancelled = "cancelled",
    Converted = "converted"
}
export declare enum CheckoutSessionStatus {
    CollectingCustomerInfo = "collecting_customer_info",
    ReadyForDraftOrder = "ready_for_draft_order",
    DraftCreated = "draft_created",
    Cancelled = "cancelled",
    Expired = "expired"
}
export declare enum OrderStatus {
    Draft = "draft",
    AwaitingManagerConfirmation = "awaiting_manager_confirmation",
    Confirmed = "confirmed",
    Cancelled = "cancelled"
}
export declare enum AuditLogType {
    AvailabilityCheck = "availability_check",
    AiDecision = "ai_decision",
    Handoff = "handoff",
    ReservationCreated = "reservation_created",
    DraftOrderCreated = "draft_order_created",
    SyncEvent = "sync_event"
}
export declare enum AuditLogStatus {
    Success = "success",
    Failed = "failed",
    Warning = "warning"
}
export declare enum ReplyDecision {
    Reply = "reply",
    AskFollowup = "ask_followup",
    Handoff = "handoff",
    CreateDraftOrder = "create_draft_order",
    Noop = "noop"
}
