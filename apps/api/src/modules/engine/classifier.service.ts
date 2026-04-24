import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { MessageRole } from '@direct-mate/shared';

// ─── Classification result ───────────────────────────────────────

export interface ClassificationResult {
  primaryIntent: string;
  entities: {
    productName?: string;
    category?: string;
    color?: string;
    size?: string;
    quantity?: number;
    customerName?: string;
    phone?: string;
    city?: string;
    deliveryBranch?: string;
  };
  conversationStage: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  confidence: number;
  dialogueAct: string;
  recommendedAction: string;
  slotAction: 'new_inquiry' | 'fills_missing_slot' | 'correction' | 'confirmation' | 'rejection' | 'adds_to_cart' | 'asks_question';
}

// ─── Assistant memory (shared with reply engine) ──────────────────

export interface AssistantMemory {
  lastAction?: string;
  lastPresentedProducts?: Array<{
    title: string;
    variants: string[];
    price: string;
  }>;
  awaitingField?: string;
  selectedCategory?: string;
  failedTurns?: number;
  orderItems?: string[];
  recentTemplateIds?: string[];
  selectionState?: string;
  selectedProductId?: string;
  selectedProductTitle?: string;
  selectedVariantId?: string;
  selectedVariantName?: string;
  availableVariants?: Array<{ id: string; name: string; color?: string | null; size?: string | null; imageUrl?: string | null }> | string;
  orderCreated?: boolean;
  cartItems?: Array<{
    productId: string;
    variantId: string;
    externalProductId: string | null;
    externalVariantId: string | null;
    title: string;
    variantName: string;
    price: number;
    currency: string;
  }>;
  preQualifyData?: Record<string, string>;
  preQualifyCollected?: boolean;
  recommendedSize?: string;
  requestedVariant?: string;
  variantStep?: 'color' | 'size' | null;
  selectedColor?: string;
}

// ─── OpenAI tool definition ──────────────────────────────────────

const CLASSIFY_MESSAGE_TOOL: OpenAI.Chat.ChatCompletionTool = {
  type: 'function',
  function: {
    name: 'classify_message',
    description:
      'Classify the customer message: detect intent, extract entities, determine conversation stage. Do NOT generate reply text.',
    parameters: {
      type: 'object',
      properties: {
        primary_intent: {
          type: 'string',
          enum: [
            'greeting',
            'product_inquiry',
            'ask_price',
            'ask_recommendation',
            'ready_to_order',
            'provide_details',
            'complaint',
            'request_human',
            'delivery_question',
            'payment_question',
            'general_question',
            'thanks',
            'confirm_choice',
            'category_browse',
            'availability_check',
            'size_chart_request',
            'unknown',
          ],
        },
        entities: {
          type: 'object',
          properties: {
            product_name: { type: 'string' },
            category: { type: 'string' },
            color: { type: 'string' },
            size: { type: 'string' },
            quantity: { type: 'number' },
            customer_name: { type: 'string' },
            phone: { type: 'string' },
            city: { type: 'string' },
            delivery_branch: { type: 'string' },
          },
        },
        conversation_stage: {
          type: 'string',
          enum: [
            'greeting',
            'need_discovery',
            'product_discovery',
            'showing_options',
            'selection_help',
            'product_selected',
            'checkout_started',
            'collecting_customer_info',
            'order_confirmation',
            'post_order_support',
            'handoff_to_manager',
          ],
        },
        sentiment: {
          type: 'string',
          enum: ['positive', 'neutral', 'negative'],
        },
        confidence: {
          type: 'number',
          description: 'Confidence score between 0 and 1',
        },
        dialogue_act: {
          type: 'string',
          enum: [
            'new_inquiry',
            'short_contextual_reply',
            'confirm_choice',
            'ask_recommendation',
            'provide_details',
            'ask_about_shown_products',
            'clarification',
            'general_chat',
          ],
        },
        recommended_action: {
          type: 'string',
          enum: [
            'show_products',
            'recommend',
            'start_checkout',
            'ask_delivery',
            'answer_question',
            'escalate',
            'greet',
            'clarify',
            'confirm_selection',
            'show_price',
            'answer_faq',
          ],
        },
        slot_action: {
          type: 'string',
          enum: [
            'new_inquiry',
            'fills_missing_slot',
            'correction',
            'confirmation',
            'rejection',
            'adds_to_cart',
            'asks_question',
          ],
          description:
            'What the user is doing in terms of slot-filling flow',
        },
      },
      required: [
        'primary_intent',
        'entities',
        'conversation_stage',
        'sentiment',
        'confidence',
        'dialogue_act',
        'recommended_action',
        'slot_action',
      ],
    },
  },
};

// ─── Service ─────────────────────────────────────────────────────

@Injectable()
export class ClassifierService {
  private readonly logger = new Logger(ClassifierService.name);
  private readonly openai: OpenAI;
  private readonly model: string;

  constructor(private readonly config: ConfigService) {
    this.openai = new OpenAI({
      apiKey: this.config.get<string>('openai.apiKey'),
    });
    this.model = this.config.get<string>('openai.model') ?? 'gpt-4o';
  }

  async classify(params: {
    messageText: string;
    recentMessages: Array<{ role: string; text: string | null }>;
    memory: AssistantMemory;
    categories: string[];
    currentStage?: string;
  }): Promise<ClassificationResult> {
    const memoryContext = this.buildMemoryContext(params.memory);

    const systemPrompt = [
      `You are a message classifier for an online store's Instagram DM assistant.`,
      `Your ONLY job is to classify the customer message. Do NOT generate any reply text.`,
      ``,
      `Analyze the message and determine:`,
      `1. Primary intent (what the customer wants)`,
      `2. Entities (product names, categories, colors, sizes, customer details)`,
      `3. Conversation stage (where we are in the sales funnel)`,
      `4. Sentiment (positive/neutral/negative)`,
      `5. Confidence (0-1)`,
      `6. Dialogue act (what the customer is doing conversationally)`,
      `7. Recommended action (what the bot should do next)`,
      ``,
      params.categories.length
        ? `Available product categories: ${params.categories.join(', ')}.`
        : '',
      params.currentStage
        ? `Current conversation stage: ${params.currentStage}`
        : '',
      memoryContext ? `\n${memoryContext}` : '',
      ``,
      `IMPORTANT RULES:`,
      `- Short replies ("так", "добре", "давайте", "цей", a color, a size) must be interpreted in context of the last action.`,
      `- If products were shown and user gives a short reply, they are likely selecting or confirming.`,
      `- If awaiting delivery info and user provides text, it's likely provide_details.`,
      `- Extract ALL relevant entities from the message.`,
      ``,
      `SLOT ACTION RULES:`,
      `- 'confirmation' ONLY for pure confirmations without new information: "так", "беру", "підходить", "давайте", "добре", "ок"`,
      `- 'correction' when user starts with negation AND provides new value: "ні, я хочу Rosewood", "не, краще червону"`,
      `- 'fills_missing_slot' when user provides a value we asked for: a color name after "який відтінок?", a product name after showing options`,
      `- 'rejection' for pure negation without new info: "ні", "не хочу", "не треба"`,
      `- 'new_inquiry' for starting a new topic or asking about something new`,
      `- 'adds_to_cart' when user wants to add another product: "і ще крем", "ще хочу..."`,
      `- 'asks_question' for questions about current selection or general: "скільки коштує?", "а яка різниця?"`,
      ``,
      `CRITICAL: Do NOT use 'confirmation' for messages that contain new information. "Ягідно-червоний" is 'fills_missing_slot', not 'confirmation'.`,
      ``,
      `SIZE CHART vs AVAILABILITY vs RECOMMENDATION — critical disambiguation:`,
      `- 'size_chart_request' ONLY when the customer asks for a sizing TABLE / CHART / measurement guide.`,
      `  Positive examples (all → size_chart_request):`,
      `    "розмірна сітка є?"`,
      `    "покажіть розміри у таблиці"`,
      `    "як зрозуміти який розмір мій?"`,
      `    "табличка з розмірами"`,
      `    "є чарт розмірів?"`,
      `    "які параметри у розмірів?"`,
      `  Negative — DO NOT classify as size_chart_request:`,
      `    "у вас є розмір М?"            → availability_check (wants in-stock status of size M)`,
      `    "є XL?"                         → availability_check`,
      `    "який у вас розмірний ряд?"     → availability_check (wants list of in-stock sizes, not a measurement chart)`,
      `    "що мені підійде? 170см 60кг"  → ask_recommendation (wants judgment from parameters)`,
      `    "порадьте розмір"               → ask_recommendation`,
      `    "який розмір брати при зрості 170?" → ask_recommendation (asking bot to choose, not asking for a table)`,
      ``,
      `Call classify_message with your analysis.`,
    ]
      .filter((s) => s !== undefined)
      .join('\n');

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
    ];

    // Add recent conversation messages for context
    for (const msg of params.recentMessages) {
      const role =
        msg.role === MessageRole.User ? 'user' : ('assistant' as const);
      messages.push({ role, content: msg.text ?? '' });
    }

    // Add current message
    messages.push({ role: 'user', content: params.messageText });

    const completion = await (this.openai.chat.completions.create as any)({
      model: this.model,
      messages,
      tools: [CLASSIFY_MESSAGE_TOOL],
      tool_choice: {
        type: 'function',
        function: { name: 'classify_message' },
      },
      max_completion_tokens: 400,
      temperature: 0.1,
    });

    const toolCall = completion.choices[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      this.logger.warn('No tool call in classification response');
      return this.defaultClassification();
    }

    let raw: any;
    try {
      raw = JSON.parse((toolCall as any).function.arguments);
    } catch (err) {
      this.logger.error('Failed to parse classification JSON', (err as Error).message);
      return this.defaultClassification();
    }

    return {
      primaryIntent: raw.primary_intent ?? 'unknown',
      entities: {
        productName: raw.entities?.product_name,
        category: raw.entities?.category,
        color: raw.entities?.color,
        size: raw.entities?.size,
        quantity: raw.entities?.quantity,
        customerName: raw.entities?.customer_name,
        phone: raw.entities?.phone,
        city: raw.entities?.city,
        deliveryBranch: raw.entities?.delivery_branch,
      },
      conversationStage: raw.conversation_stage ?? 'greeting',
      sentiment: raw.sentiment ?? 'neutral',
      confidence: raw.confidence ?? 0.5,
      dialogueAct: raw.dialogue_act ?? 'general_chat',
      recommendedAction: raw.recommended_action ?? 'clarify',
      slotAction: raw.slot_action ?? 'new_inquiry',
    };
  }

  /**
   * Second-opinion classification with fallback model (for handoff verification).
   */
  async classifyWithFallback(params: {
    messageText: string;
    recentMessages: Array<{ role: string; text: string | null }>;
    memory: AssistantMemory;
    categories: string[];
    currentStage?: string;
  }): Promise<ClassificationResult> {
    const fallbackModel = this.config.get<string>('openai.fallbackModel');
    if (!fallbackModel) {
      throw new Error('No fallback model configured');
    }

    // Temporarily override model
    const origModel = this.model;
    (this as any).model = fallbackModel;
    try {
      return await this.classify(params);
    } finally {
      (this as any).model = origModel;
    }
  }

  private buildMemoryContext(memory: AssistantMemory): string {
    if (!memory.lastAction) return '';

    const parts = [
      `ASSISTANT MEMORY (what happened before in this conversation):`,
      `Last action: ${memory.lastAction}`,
    ];

    if (memory.lastPresentedProducts?.length) {
      parts.push(`Products shown to customer:`);
      for (const p of memory.lastPresentedProducts) {
        const variants = p.variants.join(', ');
        parts.push(
          `  - ${p.title} — Price: ${p.price} — Variants: ${variants}`,
        );
      }
    }

    if (memory.orderItems?.length) {
      parts.push(`Current order items: ${memory.orderItems.join(', ')}`);
    }

    if (memory.awaitingField) {
      parts.push(`Currently waiting for: ${memory.awaitingField}`);
    }
    if (memory.selectedCategory) {
      parts.push(`Selected category: ${memory.selectedCategory}`);
    }

    // Enriched conversation state context
    parts.push(``);
    parts.push(`CONVERSATION STATE:`);
    parts.push(`- Selection state: ${memory.selectionState || 'none'}`);
    parts.push(`- Selected product: ${memory.selectedProductTitle || 'not selected'}`);
    parts.push(`- Selected variant: ${memory.selectedVariantName || 'not selected'}`);
    const variantStr = Array.isArray(memory.availableVariants)
      ? memory.availableVariants.map(v => v.name).join(', ')
      : (memory.availableVariants || 'unknown');
    parts.push(`- Available variants: ${variantStr}`);
    parts.push(`- Last bot action: ${memory.lastAction || 'none'}`);
    parts.push(`- Waiting for: ${memory.awaitingField || 'nothing specific'}`);
    if (memory.cartItems?.length) {
      parts.push(`- Cart items (${memory.cartItems.length}): ${memory.cartItems.map(i => i.title).join(', ')}`);
    }
    if (memory.variantStep) {
      parts.push(`- Variant selection step: ${memory.variantStep}`);
      if (memory.selectedColor) {
        parts.push(`- Selected color: ${memory.selectedColor}`);
      }
    }
    if (memory.preQualifyCollected && memory.preQualifyData) {
      parts.push(`- Pre-qualify data: ${JSON.stringify(memory.preQualifyData)}`);
    }

    return parts.join('\n');
  }

  private defaultClassification(): ClassificationResult {
    return {
      primaryIntent: 'unknown',
      entities: {},
      conversationStage: 'greeting',
      sentiment: 'neutral',
      confidence: 0.3,
      dialogueAct: 'general_chat',
      recommendedAction: 'clarify',
      slotAction: 'new_inquiry',
    };
  }
}
