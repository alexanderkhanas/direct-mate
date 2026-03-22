import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ExtractedConversationFragment } from './entities/extracted-conversation-fragment.entity';
import { ManagerExample } from '../settings/entities/manager-example.entity';

@Injectable()
export class ScreenshotApprovalService {
  private readonly logger = new Logger(ScreenshotApprovalService.name);

  constructor(
    @InjectRepository(ExtractedConversationFragment)
    private readonly fragmentRepo: Repository<ExtractedConversationFragment>,
    @InjectRepository(ManagerExample)
    private readonly exampleRepo: Repository<ManagerExample>,
  ) {}

  /**
   * Takes an approved fragment and creates ManagerExample records
   * from consecutive customer/manager turn pairs in the transcript.
   */
  async applyFragment(
    fragmentId: string,
    tenantId: string,
  ): Promise<{ created: number }> {
    const fragment = await this.fragmentRepo.findOne({
      where: { id: fragmentId, tenantId },
    });

    if (!fragment) {
      throw new NotFoundException('Fragment not found');
    }

    const transcript = fragment.transcriptJson as Array<{
      speaker: string;
      text: string;
    }>;

    const examples: ManagerExample[] = [];

    for (let i = 0; i < transcript.length - 1; i++) {
      const current = transcript[i];
      const next = transcript[i + 1];

      if (current.speaker === 'customer' && next.speaker === 'manager') {
        examples.push(
          this.exampleRepo.create({
            tenantId,
            scenario: fragment.scenarioSuggestion,
            customerMessage: current.text,
            managerReply: next.text,
            tags: ['screenshot-import'],
            isActive: true,
          }),
        );
      }
    }

    if (examples.length > 0) {
      await this.exampleRepo.save(examples);
    }

    await this.fragmentRepo.update(fragmentId, { reviewStatus: 'applied' });

    this.logger.log(
      `Applied fragment ${fragmentId}: created ${examples.length} manager examples`,
    );

    return { created: examples.length };
  }
}
