import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import OpenAI from 'openai';
import * as fs from 'fs';
import { ScreenshotImportJob } from './entities/screenshot-import-job.entity';
import { ScreenshotImportFile } from './entities/screenshot-import-file.entity';
import { ExtractedConversationFragment } from './entities/extracted-conversation-fragment.entity';
import { ExtractedPhrase } from './entities/extracted-phrase.entity';
import { ExtractedVoiceSignal } from './entities/extracted-voice-signal.entity';

interface TranscriptTurn {
  speaker: 'manager' | 'customer';
  text: string;
}

interface ExtractedPhraseData {
  phrase: string;
  scenario: string;
}

interface AvoidPhraseData {
  phrase: string;
  reason: string;
}

interface VoiceSignalData {
  type: string;
  value: string;
  evidence: string;
}

interface ExtractionResult {
  transcript: TranscriptTurn[];
  good_phrases: ExtractedPhraseData[];
  avoid_phrases: AvoidPhraseData[];
  scenario: string;
  confidence: number;
  voice_signals: VoiceSignalData[];
}

interface GroupingResult {
  conversations: Array<{
    fragment_ids: string[];
    merged_transcript: TranscriptTurn[];
    scenario: string;
    summary: string;
  }>;
}

const GROUPING_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: 'function' as const,
  function: {
    name: 'save_grouped_conversations',
    description: 'Group extracted transcript fragments into separate conversations',
    parameters: {
      type: 'object',
      properties: {
        conversations: {
          type: 'array',
          description: 'Array of grouped conversations. Each group contains fragment IDs that belong to the same conversation, a merged transcript, and a scenario.',
          items: {
            type: 'object',
            properties: {
              fragment_ids: {
                type: 'array',
                items: { type: 'string' },
                description: 'IDs of fragments that belong to this conversation',
              },
              merged_transcript: {
                type: 'array',
                description: 'The full merged conversation in correct order',
                items: {
                  type: 'object',
                  properties: {
                    speaker: { type: 'string', enum: ['manager', 'customer'] },
                    text: { type: 'string' },
                  },
                  required: ['speaker', 'text'],
                },
              },
              scenario: {
                type: 'string',
                description: 'Overall scenario for this conversation',
              },
              summary: {
                type: 'string',
                description: 'Brief summary of what this conversation is about',
              },
            },
            required: ['fragment_ids', 'merged_transcript', 'scenario', 'summary'],
          },
        },
      },
      required: ['conversations'],
    },
  },
};

const EXTRACTION_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function' as const,
    function: {
      name: 'save_extraction',
      description:
        'Save the extracted conversation data from the screenshot of a customer-manager chat.',
      parameters: {
        type: 'object',
        properties: {
          transcript: {
            type: 'array',
            description: 'The conversation turns extracted from the screenshot.',
            items: {
              type: 'object',
              properties: {
                speaker: {
                  type: 'string',
                  enum: ['manager', 'customer'],
                  description: 'Who sent this message.',
                },
                text: {
                  type: 'string',
                  description: 'The text content of the message.',
                },
              },
              required: ['speaker', 'text'],
            },
          },
          good_phrases: {
            type: 'array',
            description: 'Good manager phrases worth learning from.',
            items: {
              type: 'object',
              properties: {
                phrase: { type: 'string' },
                scenario: { type: 'string' },
              },
              required: ['phrase', 'scenario'],
            },
          },
          avoid_phrases: {
            type: 'array',
            description: 'Phrases that should be avoided.',
            items: {
              type: 'object',
              properties: {
                phrase: { type: 'string' },
                reason: { type: 'string' },
              },
              required: ['phrase', 'reason'],
            },
          },
          scenario: {
            type: 'string',
            description:
              'The overall scenario classification (e.g. "product_inquiry", "complaint", "order_followup").',
          },
          confidence: {
            type: 'number',
            description: 'Confidence score from 0 to 1 for the extraction quality.',
          },
          voice_signals: {
            type: 'array',
            description:
              'Voice/tone signals detected in the manager responses (e.g. empathy, urgency, formality).',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', description: 'Signal category (e.g. "tone", "empathy", "formality").' },
                value: { type: 'string', description: 'The signal value (e.g. "warm", "high", "casual").' },
                evidence: { type: 'string', description: 'The text that demonstrates this signal.' },
              },
              required: ['type', 'value', 'evidence'],
            },
          },
        },
        required: ['transcript', 'good_phrases', 'avoid_phrases', 'scenario', 'confidence', 'voice_signals'],
      },
    },
  },
];

@Injectable()
export class ScreenshotExtractionService {
  private readonly logger = new Logger(ScreenshotExtractionService.name);
  private readonly openai: OpenAI;
  private readonly model: string;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(ScreenshotImportJob)
    private readonly jobRepo: Repository<ScreenshotImportJob>,
    @InjectRepository(ScreenshotImportFile)
    private readonly fileRepo: Repository<ScreenshotImportFile>,
    @InjectRepository(ExtractedConversationFragment)
    private readonly fragmentRepo: Repository<ExtractedConversationFragment>,
    @InjectRepository(ExtractedPhrase)
    private readonly phraseRepo: Repository<ExtractedPhrase>,
    @InjectRepository(ExtractedVoiceSignal)
    private readonly voiceSignalRepo: Repository<ExtractedVoiceSignal>,
  ) {
    this.openai = new OpenAI({
      apiKey: this.configService.get<string>('openai.apiKey'),
    });
    this.model = this.configService.get<string>('openai.model') ?? 'gpt-4o';
  }

  /**
   * Process all files for a job, with max 3 concurrent extractions.
   * Called fire-and-forget from the upload controller.
   */
  async processJob(jobId: string): Promise<void> {
    const files = await this.fileRepo.find({ where: { jobId } });

    await this.jobRepo.update(jobId, { status: 'processing' });

    const concurrency = 3;
    const queue = [...files];
    const active: Promise<void>[] = [];

    const processNext = async (): Promise<void> => {
      while (queue.length > 0) {
        const file = queue.shift()!;
        await this.processFile(file);
        await this.jobRepo.increment({ id: jobId }, 'processedFiles', 1);
      }
    };

    for (let i = 0; i < Math.min(concurrency, queue.length); i++) {
      active.push(processNext());
    }

    await Promise.all(active);

    // After all files extracted, group fragments into conversations
    await this.groupFragmentsIntoConversations(jobId);

    await this.jobRepo.update(jobId, {
      status: 'completed',
      completedAt: new Date(),
    });
  }

  /**
   * Post-extraction step: group fragments from multiple screenshots
   * into coherent conversations using AI.
   */
  private async groupFragmentsIntoConversations(jobId: string): Promise<void> {
    const files = await this.fileRepo.find({ where: { jobId } });
    const fileIds = files.map((f) => f.id);

    if (fileIds.length === 0) return;

    const fragments = await this.fragmentRepo
      .createQueryBuilder('f')
      .where('f.file_id IN (:...fileIds)', { fileIds })
      .orderBy('f.created_at', 'ASC')
      .getMany();

    if (fragments.length <= 1) return; // Nothing to group

    // Build a summary of each fragment for the AI
    const fragmentSummaries = fragments.map((f, i) => {
      const transcript = (f.transcriptJson as TranscriptTurn[]) || [];
      const preview = transcript
        .map((t) => `${t.speaker}: ${t.text}`)
        .join('\n');
      return `--- Fragment ${f.id} (screenshot ${i + 1}) ---\n${preview}`;
    });

    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content: [
              'You are an expert at analyzing chat conversation fragments.',
              'You will receive multiple transcript fragments extracted from separate screenshots.',
              'Your job is to determine which fragments belong to the SAME conversation and group them together.',
              '',
              'Clues for grouping:',
              '- Same topic/product being discussed',
              '- Continuation of a conversation flow (e.g. greeting → inquiry → recommendation → order)',
              '- Same customer questions or context',
              '- Overlapping messages (screenshots may capture some of the same messages)',
              '',
              'Rules:',
              '- If two fragments clearly continue the same conversation, merge them into one group',
              '- If a fragment seems standalone, keep it as its own group',
              '- Remove duplicate messages when merging (screenshots often overlap)',
              '- Arrange the merged transcript in logical conversation order',
              '- Each fragment must appear in exactly one group',
            ].join('\n'),
          },
          {
            role: 'user',
            content: `Here are ${fragments.length} transcript fragments from screenshots. Group them into separate conversations:\n\n${fragmentSummaries.join('\n\n')}`,
          },
        ],
        tools: [GROUPING_TOOL],
        tool_choice: { type: 'function', function: { name: 'save_grouped_conversations' } },
        max_completion_tokens: 4096,
        temperature: 0.2,
      } as any);

      const toolCall = response.choices[0]?.message?.tool_calls?.[0];
      if (!toolCall) {
        this.logger.warn('No grouping result returned from AI');
        return;
      }

      let grouping: GroupingResult;
      try {
        grouping = JSON.parse((toolCall as any).function.arguments);
      } catch (err) {
        this.logger.error('Failed to parse grouping JSON', (err as Error).message);
        return;
      }

      this.logger.log(
        `Grouped ${fragments.length} fragments into ${grouping.conversations.length} conversation(s)`,
      );

      // Update fragments with grouping info
      for (let groupIdx = 0; groupIdx < grouping.conversations.length; groupIdx++) {
        const conv = grouping.conversations[groupIdx];

        // For multi-fragment groups, update the first fragment with the merged transcript
        // and mark others as merged
        if (conv.fragment_ids.length > 1) {
          const primaryId = conv.fragment_ids[0];

          // Verify fragment IDs exist (AI might hallucinate IDs)
          const validIds = conv.fragment_ids.filter((id) =>
            fragments.some((f) => f.id === id),
          );
          if (validIds.length === 0) continue;

          const realPrimaryId = validIds[0];

          // Update primary fragment with merged transcript
          await this.fragmentRepo.update(realPrimaryId, {
            transcriptJson: conv.merged_transcript as any,
            scenarioSuggestion: conv.scenario,
          });

          // Mark secondary fragments as merged (set review_status so they're skipped in review)
          for (const secondaryId of validIds.slice(1)) {
            await this.fragmentRepo.update(secondaryId, {
              reviewStatus: 'merged',
              scenarioSuggestion: `merged_into:${realPrimaryId}`,
            });
          }

          this.logger.log(
            `Merged ${validIds.length} fragments into conversation: "${conv.summary.substring(0, 60)}"`,
          );
        } else if (conv.fragment_ids.length === 1) {
          const fragId = conv.fragment_ids[0];
          if (fragments.some((f) => f.id === fragId)) {
            await this.fragmentRepo.update(fragId, {
              scenarioSuggestion: conv.scenario,
            });
          }
        }
      }
    } catch (err) {
      this.logger.error('Fragment grouping failed, fragments will remain ungrouped', err);
      // Non-fatal — fragments are still usable individually
    }
  }

  /**
   * Run GPT text-only extraction on a live observation fragment that has no phrases/signals yet.
   * Called on-demand from the review UI.
   */
  async analyzeFragment(fragmentId: string, tenantId: string): Promise<{ success: boolean }> {
    const fragment = await this.fragmentRepo.findOne({
      where: { id: fragmentId, tenantId },
    });
    if (!fragment) {
      throw new NotFoundException('Fragment not found');
    }

    const transcript = (fragment.transcriptJson as TranscriptTurn[]) || [];
    if (transcript.length === 0) {
      return { success: false };
    }

    const transcriptText = transcript
      .map((t) => `${t.speaker === 'manager' ? 'Manager' : 'Customer'}: ${t.text}`)
      .join('\n');

    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'system',
          content:
            'You are an expert at analyzing customer-manager chat conversations. ' +
            'Extract good phrases, phrases to avoid, classify the scenario, and detect voice/tone signals. ' +
            'Call the save_extraction function with your results.',
        },
        {
          role: 'user',
          content: `Analyze this customer-manager conversation and extract training data:\n\n${transcriptText}`,
        },
      ],
      tools: EXTRACTION_TOOLS,
      tool_choice: { type: 'function', function: { name: 'save_extraction' } },
      max_completion_tokens: 4096,
    } as any);

    const toolCall = response.choices[0]?.message?.tool_calls?.[0];
    if (!toolCall || toolCall.type !== 'function') {
      this.logger.warn(`No extraction result from AI for fragment ${fragmentId}`);
      return { success: false };
    }

    let extraction: ExtractionResult;
    try {
      extraction = JSON.parse((toolCall as any).function.arguments);
    } catch (err) {
      this.logger.error(`Failed to parse extraction JSON for fragment ${fragmentId}`, (err as Error).message);
      return { success: false };
    }

    // Update fragment with scenario/confidence
    await this.fragmentRepo.update(fragmentId, {
      scenarioSuggestion: extraction.scenario,
      confidenceScore: extraction.confidence,
    });

    // Save phrases
    const phraseEntities: ExtractedPhrase[] = [];
    for (const gp of extraction.good_phrases) {
      phraseEntities.push(
        this.phraseRepo.create({
          tenantId,
          fragmentId,
          phrase: gp.phrase,
          phraseType: 'good',
          scenario: gp.scenario,
          confidenceScore: extraction.confidence,
          approvalStatus: 'pending',
        }),
      );
    }
    for (const ap of extraction.avoid_phrases) {
      phraseEntities.push(
        this.phraseRepo.create({
          tenantId,
          fragmentId,
          phrase: ap.phrase,
          phraseType: 'avoid',
          scenario: ap.reason,
          confidenceScore: extraction.confidence,
          approvalStatus: 'pending',
        }),
      );
    }
    if (phraseEntities.length > 0) {
      await this.phraseRepo.save(phraseEntities);
    }

    // Save voice signals
    const signalEntities: ExtractedVoiceSignal[] = [];
    for (const vs of extraction.voice_signals) {
      signalEntities.push(
        this.voiceSignalRepo.create({
          tenantId,
          fragmentId,
          signalType: vs.type,
          signalValue: vs.value,
          evidenceText: vs.evidence,
          confidenceScore: extraction.confidence,
          approvalStatus: 'pending',
        }),
      );
    }
    if (signalEntities.length > 0) {
      await this.voiceSignalRepo.save(signalEntities);
    }

    this.logger.log(`analyzeFragment: extracted ${phraseEntities.length} phrases, ${signalEntities.length} signals for fragment ${fragmentId}`);
    return { success: true };
  }

  private async processFile(file: ScreenshotImportFile): Promise<void> {
    try {
      await this.fileRepo.update(file.id, {
        ocrStatus: 'processing',
        extractionStatus: 'processing',
      });

      const filePath = file.fileUrl;
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found on disk: ${filePath}`);
      }
      const imageBuffer = fs.readFileSync(filePath);
      const base64Image = imageBuffer.toString('base64');

      const mimeType = file.mimeType || 'image/png';
      const dataUri = `data:${mimeType};base64,${base64Image}`;

      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: 'system',
            content:
              'You are an expert at analyzing screenshots of customer-manager chat conversations. ' +
              'Extract the conversation transcript, identify good phrases, phrases to avoid, ' +
              'classify the scenario, and detect voice/tone signals. ' +
              'Call the save_extraction function with your results.',
          },
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: dataUri, detail: 'high' },
              },
              {
                type: 'text',
                text: 'Analyze this screenshot of a customer-manager conversation. Extract the transcript, good phrases, phrases to avoid, scenario classification, and voice signals.',
              },
            ],
          },
        ],
        tools: EXTRACTION_TOOLS,
        tool_choice: { type: 'function', function: { name: 'save_extraction' } },
        max_completion_tokens: 4096,
      } as any);

      const toolCall = response.choices[0]?.message?.tool_calls?.[0];
      if (!toolCall || toolCall.type !== 'function') {
        throw new Error('No function tool call returned from OpenAI');
      }
      if (toolCall.function.name !== 'save_extraction') {
        throw new Error(`Unexpected tool call: ${toolCall.function.name}`);
      }

      let extraction: ExtractionResult;
      try {
        extraction = JSON.parse(toolCall.function.arguments);
      } catch (err) {
        this.logger.error(`Failed to parse extraction JSON for file ${file.id}`, (err as Error).message);
        await this.fileRepo.update(file.id, { extractionStatus: 'failed' });
        return;
      }

      await this.fileRepo.update(file.id, {
        ocrStatus: 'completed',
        extractionStatus: 'completed',
        extractedTextRaw: extraction.transcript.map((t) => `${t.speaker}: ${t.text}`).join('\n'),
        extractionMetadata: {
          scenario: extraction.scenario,
          confidence: extraction.confidence,
          goodPhrasesCount: extraction.good_phrases.length,
          avoidPhrasesCount: extraction.avoid_phrases.length,
          voiceSignalsCount: extraction.voice_signals.length,
        },
      });

      const fragment = this.fragmentRepo.create({
        fileId: file.id,
        tenantId: file.tenantId,
        transcriptJson: extraction.transcript,
        scenarioSuggestion: extraction.scenario,
        confidenceScore: extraction.confidence,
        reviewStatus: 'pending',
      });
      const savedFragment = await this.fragmentRepo.save(fragment);

      const phraseEntities: ExtractedPhrase[] = [];
      for (const gp of extraction.good_phrases) {
        phraseEntities.push(
          this.phraseRepo.create({
            tenantId: file.tenantId,
            fragmentId: savedFragment.id,
            phrase: gp.phrase,
            phraseType: 'good',
            scenario: gp.scenario,
            confidenceScore: extraction.confidence,
            approvalStatus: 'pending',
          }),
        );
      }
      for (const ap of extraction.avoid_phrases) {
        phraseEntities.push(
          this.phraseRepo.create({
            tenantId: file.tenantId,
            fragmentId: savedFragment.id,
            phrase: ap.phrase,
            phraseType: 'avoid',
            scenario: ap.reason,
            confidenceScore: extraction.confidence,
            approvalStatus: 'pending',
          }),
        );
      }
      if (phraseEntities.length > 0) {
        await this.phraseRepo.save(phraseEntities);
      }

      const signalEntities: ExtractedVoiceSignal[] = [];
      for (const vs of extraction.voice_signals) {
        signalEntities.push(
          this.voiceSignalRepo.create({
            tenantId: file.tenantId,
            fragmentId: savedFragment.id,
            signalType: vs.type,
            signalValue: vs.value,
            evidenceText: vs.evidence,
            confidenceScore: extraction.confidence,
            approvalStatus: 'pending',
          }),
        );
      }
      if (signalEntities.length > 0) {
        await this.voiceSignalRepo.save(signalEntities);
      }

      this.logger.log(`Successfully processed file ${file.id} (${file.fileName})`);
    } catch (error) {
      this.logger.error(`Failed to process file ${file.id}: ${error}`);
      await this.fileRepo.update(file.id, {
        ocrStatus: 'failed',
        extractionStatus: 'failed',
        extractionMetadata: {
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }
}
