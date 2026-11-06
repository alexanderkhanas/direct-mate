import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { InternalApiKeyGuard } from '../../common/guards/internal-api-key.guard';
import { ConversationsService } from './conversations.service';
import { TurnRunner } from './turn-runner.service';
import { ConversationReplyDto } from './dto/conversation-reply.dto';
import { MessageDirection, MessageRole, ReplyDecision } from '@direct-mate/shared';

/**
 * Re-drive one customer message through the agent from outside (n8n, ops).
 * Runs in live mode — escalation, Telegram and order sync all happen — but
 * sending to the customer's channel is the caller's job: the messages to send
 * are in the response.
 */
@ApiTags('conversation-reply')
@UseGuards(InternalApiKeyGuard)
@Controller('conversation')
export class ConversationReplyController {
  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly turnRunner: TurnRunner,
  ) {}

  @Post('reply')
  async reply(@Body() dto: ConversationReplyDto) {
    const customer = await this.conversationsService.findOrCreateCustomer(
      dto.tenantId,
      dto.channel,
      dto.externalUserId,
    );

    const { conversation } = await this.conversationsService.findOrCreateConversation(
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

    const result = await this.turnRunner.run({
      tenantId: dto.tenantId,
      conversationId: conversation.id,
      mode: 'live',
      source: 'manual_api',
    });

    return {
      conversationId: conversation.id,
      status: result.status,
      decision: result.handoff
        ? ReplyDecision.Handoff
        : result.committed.orderId
          ? ReplyDecision.CreateDraftOrder
          : ReplyDecision.Reply,
      messages: result.messages,
      handoff: { required: !!result.handoff, reason: result.handoff?.reason ?? null },
      orderId: result.committed.orderId,
      traceId: result.traceId,
    };
  }
}
