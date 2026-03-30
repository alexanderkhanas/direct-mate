"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ReplyDecision = exports.AuditLogStatus = exports.AuditLogType = exports.OrderStatus = exports.CheckoutSessionStatus = exports.ReservationStatus = exports.MessageRole = exports.MessageDirection = exports.ConversationStateStatus = exports.ConversationStatus = exports.ProductStatus = exports.SyncJobStatus = exports.SyncMode = exports.SyncType = exports.ConnectionStatus = exports.ConnectionType = exports.UserRole = exports.BusinessType = void 0;
var BusinessType;
(function (BusinessType) {
    BusinessType["Fashion"] = "fashion";
    BusinessType["Beauty"] = "beauty";
    BusinessType["Barber"] = "barber";
})(BusinessType || (exports.BusinessType = BusinessType = {}));
var UserRole;
(function (UserRole) {
    UserRole["Owner"] = "owner";
    UserRole["Manager"] = "manager";
    UserRole["Admin"] = "admin";
    UserRole["Superadmin"] = "superadmin";
})(UserRole || (exports.UserRole = UserRole = {}));
var ConnectionType;
(function (ConnectionType) {
    ConnectionType["Instagram"] = "instagram";
    ConnectionType["KeyCrm"] = "keycrm";
    ConnectionType["SalesDrive"] = "salesdrive";
    ConnectionType["Shopify"] = "shopify";
    ConnectionType["WooCommerce"] = "woocommerce";
    ConnectionType["GoogleSheets"] = "google_sheets";
})(ConnectionType || (exports.ConnectionType = ConnectionType = {}));
var ConnectionStatus;
(function (ConnectionStatus) {
    ConnectionStatus["Connected"] = "connected";
    ConnectionStatus["Disconnected"] = "disconnected";
    ConnectionStatus["Error"] = "error";
    ConnectionStatus["Pending"] = "pending";
})(ConnectionStatus || (exports.ConnectionStatus = ConnectionStatus = {}));
var SyncType;
(function (SyncType) {
    SyncType["Catalog"] = "catalog";
    SyncType["Stock"] = "stock";
    SyncType["Customers"] = "customers";
    SyncType["Slots"] = "slots";
})(SyncType || (exports.SyncType = SyncType = {}));
var SyncMode;
(function (SyncMode) {
    SyncMode["Full"] = "full";
    SyncMode["Incremental"] = "incremental";
    SyncMode["FileImport"] = "file_import";
})(SyncMode || (exports.SyncMode = SyncMode = {}));
var SyncJobStatus;
(function (SyncJobStatus) {
    SyncJobStatus["Queued"] = "queued";
    SyncJobStatus["Running"] = "running";
    SyncJobStatus["Success"] = "success";
    SyncJobStatus["Failed"] = "failed";
})(SyncJobStatus || (exports.SyncJobStatus = SyncJobStatus = {}));
var ProductStatus;
(function (ProductStatus) {
    ProductStatus["Active"] = "active";
    ProductStatus["Archived"] = "archived";
    ProductStatus["Draft"] = "draft";
})(ProductStatus || (exports.ProductStatus = ProductStatus = {}));
var ConversationStatus;
(function (ConversationStatus) {
    ConversationStatus["Active"] = "active";
    ConversationStatus["HumanInControl"] = "human_in_control";
    ConversationStatus["WaitingCustomer"] = "waiting_customer";
    ConversationStatus["Closed"] = "closed";
})(ConversationStatus || (exports.ConversationStatus = ConversationStatus = {}));
var ConversationStateStatus;
(function (ConversationStateStatus) {
    ConversationStateStatus["Browsing"] = "browsing";
    ConversationStateStatus["ProductSelected"] = "product_selected";
    ConversationStateStatus["StockConfirmed"] = "stock_confirmed";
    ConversationStateStatus["CollectingCustomerInfo"] = "collecting_customer_info";
    ConversationStateStatus["AwaitingManagerConfirmation"] = "awaiting_manager_confirmation";
    ConversationStateStatus["Closed"] = "closed";
})(ConversationStateStatus || (exports.ConversationStateStatus = ConversationStateStatus = {}));
var MessageDirection;
(function (MessageDirection) {
    MessageDirection["Inbound"] = "inbound";
    MessageDirection["Outbound"] = "outbound";
})(MessageDirection || (exports.MessageDirection = MessageDirection = {}));
var MessageRole;
(function (MessageRole) {
    MessageRole["User"] = "user";
    MessageRole["Assistant"] = "assistant";
    MessageRole["Manager"] = "manager";
    MessageRole["System"] = "system";
})(MessageRole || (exports.MessageRole = MessageRole = {}));
var ReservationStatus;
(function (ReservationStatus) {
    ReservationStatus["Active"] = "active";
    ReservationStatus["Expired"] = "expired";
    ReservationStatus["Cancelled"] = "cancelled";
    ReservationStatus["Converted"] = "converted";
})(ReservationStatus || (exports.ReservationStatus = ReservationStatus = {}));
var CheckoutSessionStatus;
(function (CheckoutSessionStatus) {
    CheckoutSessionStatus["CollectingCustomerInfo"] = "collecting_customer_info";
    CheckoutSessionStatus["ReadyForDraftOrder"] = "ready_for_draft_order";
    CheckoutSessionStatus["DraftCreated"] = "draft_created";
    CheckoutSessionStatus["Cancelled"] = "cancelled";
    CheckoutSessionStatus["Expired"] = "expired";
})(CheckoutSessionStatus || (exports.CheckoutSessionStatus = CheckoutSessionStatus = {}));
var OrderStatus;
(function (OrderStatus) {
    OrderStatus["Draft"] = "draft";
    OrderStatus["AwaitingManagerConfirmation"] = "awaiting_manager_confirmation";
    OrderStatus["Confirmed"] = "confirmed";
    OrderStatus["Shipped"] = "shipped";
    OrderStatus["Delivered"] = "delivered";
    OrderStatus["Cancelled"] = "cancelled";
})(OrderStatus || (exports.OrderStatus = OrderStatus = {}));
var AuditLogType;
(function (AuditLogType) {
    AuditLogType["AvailabilityCheck"] = "availability_check";
    AuditLogType["AiDecision"] = "ai_decision";
    AuditLogType["Handoff"] = "handoff";
    AuditLogType["ReservationCreated"] = "reservation_created";
    AuditLogType["DraftOrderCreated"] = "draft_order_created";
    AuditLogType["SyncEvent"] = "sync_event";
})(AuditLogType || (exports.AuditLogType = AuditLogType = {}));
var AuditLogStatus;
(function (AuditLogStatus) {
    AuditLogStatus["Success"] = "success";
    AuditLogStatus["Failed"] = "failed";
    AuditLogStatus["Warning"] = "warning";
})(AuditLogStatus || (exports.AuditLogStatus = AuditLogStatus = {}));
var ReplyDecision;
(function (ReplyDecision) {
    ReplyDecision["Reply"] = "reply";
    ReplyDecision["AskFollowup"] = "ask_followup";
    ReplyDecision["Handoff"] = "handoff";
    ReplyDecision["CreateDraftOrder"] = "create_draft_order";
    ReplyDecision["Noop"] = "noop";
})(ReplyDecision || (exports.ReplyDecision = ReplyDecision = {}));
