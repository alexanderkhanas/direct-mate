export interface OrderPayload {
  tenantId: string;
  conversationId: string;
  customerId: string;
  items: Array<{
    productId: string;
    variantId: string;
    externalProductId: string | null;
    externalVariantId: string | null;
    title: string;
    variantTitle: string;
    quantity: number;
    unitPrice: number;
    currency: string;
  }>;
  customerInfo: {
    fullName: string;
    phone: string;
    city: string;
    deliveryBranch: string;
    paymentMethod?: string;
    comment?: string;
  };
  source: 'instagram_ai';
}
