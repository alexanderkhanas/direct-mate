import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'crypto';
import { InternalApiKeyGuard } from '../../common/guards/internal-api-key.guard';
import { ConversationsService } from './conversations.service';
import { ReplyEngineService } from './reply-engine.service';
import { ConversationReplyDto } from './dto/conversation-reply.dto';
import { MessageDirection, MessageRole } from '@direct-mate/shared';

@ApiTags('conversation-reply')
@UseGuards(InternalApiKeyGuard)
@Controller('conversation')
export class ConversationReplyController {
  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly replyEngineService: ReplyEngineService,
  ) {}

  @Post('reply')
  async reply(@Body() dto: ConversationReplyDto) {
    const customer = await this.conversationsService.findOrCreateCustomer(
      dto.tenantId,
      dto.channel,
      dto.externalUserId,
    );

    const { conversation, state } = await this.conversationsService.findOrCreateConversation(
      dto.tenantId,
      customer.id,
      dto.channel,
      dto.channelAccountId,
    );

    await this.conversationsService.saveMessage(
      conversation.id,
      dto.tenantId,
      MessageDirection.Inbound,
      MessageRole.User,
      dto.messageText,
      dto.messageId,
    );

    const recentMessages =
      await this.conversationsService.getRecentMessages(conversation.id, 10);

    const result = await this.replyEngineService.process({
      source: 'manual_api',
      tenantId: dto.tenantId,
      conversationId: conversation.id,
      messageText: dto.messageText,
      state,
      recentMessages,
      traceId: randomUUID(),
    });

    if (result.stateUpdate) {
      await this.conversationsService.updateState(conversation.id, result.stateUpdate);
    }

    if (result.handoff.required) {
      await this.conversationsService.escalate(
        conversation.id,
        result.handoff.reason ?? 'unknown',
      );
    } else if (result.reply?.sendNow && result.reply.text) {
      await this.conversationsService.saveMessage(
        conversation.id,
        dto.tenantId,
        MessageDirection.Outbound,
        MessageRole.Assistant,
        result.reply.text,
      );
    }

    const updatedConv = await this.conversationsService.findById(conversation.id);

    return {
      conversationId: conversation.id,
      decision: result.decision,
      reply: result.reply,
      handoff: result.handoff,
      state: {
        status: updatedConv.state?.stateStatus,
        selectedProductId: updatedConv.state?.selectedProductId,
        selectedVariantId: updatedConv.state?.selectedVariantId,
      },
    };
  }
}
