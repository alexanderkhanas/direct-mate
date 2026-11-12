import { InstagramCommentService } from './instagram-comment.service';
import type { TurnRunResult } from '../../conversations/turn-runner.service';

const COMMENT = { id: 'comment-1', from: { id: 'igsid-7', username: 'olena' }, media: { id: 'media-1' }, text: 'Ціна?' };

function runResult(overrides: Partial<TurnRunResult> = {}): TurnRunResult {
  return {
    status: 'replied',
    messages: [
      { kind: 'welcome', text: 'Вітаю, з вами AI-асистент', messageId: 'm-welcome' },
      { kind: 'reply', text: 'Сорочка льон — 3300 грн.', imageUrls: ['/uploads/a.jpg'], messageId: 'm-reply' },
    ],
    handoff: null,
    committed: { orderId: null, paymentDetailsSent: false },
    agent: null,
    traceId: 't-1',
    ...overrides,
  };
}

function setup(
  opts: { question?: boolean; saved?: string | null; result?: TurnRunResult; sendFails?: boolean; linked?: boolean } = {},
) {
  const deps = {
    integrations: {
      findByExternalAccountId: jest.fn().mockResolvedValue({
        id: 'conn-1',
        tenantId: 'tenant-1',
        externalAccountId: 'ig-shop',
        accessTokenEncrypted: 'enc',
      }),
    },
    content: { findByMediaId: jest.fn().mockResolvedValue(opts.linked === false ? null : { productId: 'product-1' }) },
    conversations: {
      findOrCreateCustomer: jest.fn().mockResolvedValue({ id: 'customer-1', username: null }),
      updateCustomer: jest.fn(),
      findOrCreateConversation: jest.fn().mockResolvedValue({ conversation: { id: 'conv-1' } }),
      saveChannelMessage: jest.fn().mockResolvedValue(opts.saved === undefined ? 'msg-in' : opts.saved),
    },
    runner: { run: jest.fn().mockResolvedValue(opts.result ?? runResult()) },
    settings: { load: jest.fn().mockResolvedValue({ operatingMode: 'active' }) },
    crypto: { decrypt: jest.fn().mockReturnValue('token') },
    sender: {
      sendText: opts.sendFails
        ? jest.fn().mockRejectedValue(new Error('(#10) outside the allowed window'))
        : jest.fn().mockResolvedValue(['mid-1']),
    },
    config: { get: jest.fn() },
    db: { query: jest.fn().mockResolvedValue([{ flow_config: {} }]) },
    contentMedia: { capture: jest.fn().mockResolvedValue({}) },
  };
  const service = new InstagramCommentService(
    deps.integrations as never,
    deps.conversations as never,
    deps.runner as never,
    deps.settings as never,
    deps.crypto as never,
    deps.sender as never,
    deps.config as never,
    deps.db as never,
    deps.contentMedia as never,
  );
  const gate = jest
    .spyOn(service as unknown as { isQuestionForShop: () => Promise<boolean> }, 'isQuestionForShop')
    .mockResolvedValue(opts.question ?? true);
  const fetchMock = jest.fn().mockResolvedValue({ ok: true, text: async () => '' });
  global.fetch = fetchMock as never;
  return { service, deps, fetchMock, gate };
}

describe('InstagramCommentService', () => {
  it('leaves comments that ask the shop nothing alone', async () => {
    const { service, deps, fetchMock } = setup({ question: false });
    await service.handleComment('ig-shop', { ...COMMENT, text: 'Гарна 😍' });
    expect(deps.conversations.saveChannelMessage).not.toHaveBeenCalled();
    expect(deps.runner.run).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers a question in the commenter's DM conversation, as one private reply, then points to Direct", async () => {
    const { service, deps, fetchMock } = setup();
    await service.handleComment('ig-shop', COMMENT);

    expect(deps.conversations.findOrCreateCustomer).toHaveBeenCalledWith('tenant-1', 'instagram', 'igsid-7');
    expect(deps.conversations.findOrCreateConversation).toHaveBeenCalledWith('tenant-1', 'customer-1', 'instagram', 'ig-shop');
    expect(deps.conversations.saveChannelMessage).toHaveBeenCalledWith(
      'conv-1',
      'tenant-1',
      expect.anything(),
      'Ціна?',
      'comment-1',
      [{ type: 'post_comment', mediaId: 'media-1' }],
    );
    const run = deps.runner.run.mock.calls[0][0];
    expect(run).toMatchObject({ conversationId: 'conv-1', mode: 'live' });
    expect(run.notes[0]).toContain('one private message');

    // Welcome and reply in one text, without the photo.
    expect(deps.sender.sendText).toHaveBeenCalledTimes(1);
    expect(deps.sender.sendText).toHaveBeenCalledWith(
      expect.anything(),
      { comment_id: 'comment-1' },
      'Вітаю, з вами AI-асистент\n\nСорочка льон — 3300 грн.',
      expect.objectContaining({ messageId: 'm-reply' }),
    );
    expect(deps.db.query).toHaveBeenCalledWith(expect.stringContaining("delivery_status = 'sent'"), [['m-welcome', 'm-reply']]);
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/comment-1/replies'), expect.anything());
  });

  it("answers a comment under a post that isn't linked to a product, with the post's image copied while it is screened", async () => {
    const { service, deps, fetchMock, gate } = setup({ linked: false });
    await service.handleComment('ig-shop', COMMENT);

    expect(deps.contentMedia.capture).toHaveBeenCalledWith('tenant-1', { type: 'post_comment', mediaId: 'media-1' });
    expect(deps.contentMedia.capture.mock.invocationCallOrder[0]).toBeLessThan(gate.mock.invocationCallOrder[0]);
    // The turn itself waits for the copy (TurnRunner → ContentMediaService.prepare) and finds it on the attachment.
    expect(deps.conversations.saveChannelMessage).toHaveBeenCalledWith(
      'conv-1',
      'tenant-1',
      expect.anything(),
      'Ціна?',
      'comment-1',
      [{ type: 'post_comment', mediaId: 'media-1' }],
    );
    expect(deps.runner.run).toHaveBeenCalledTimes(1);
    expect(deps.sender.sendText).toHaveBeenCalledWith(expect.anything(), { comment_id: 'comment-1' }, expect.any(String), expect.anything());
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/comment-1/replies'), expect.anything());
  });

  it("answers the comment even when copying the post's image fails", async () => {
    const { service, deps } = setup({ linked: false });
    deps.contentMedia.capture.mockRejectedValueOnce(new Error('disk full'));
    await service.handleComment('ig-shop', COMMENT);
    await new Promise((r) => setImmediate(r));
    expect(deps.runner.run).toHaveBeenCalledTimes(1);
  });

  it('still ignores comments under reels', async () => {
    const { service, deps } = setup({ linked: false });
    await service.handleComment('ig-shop', { ...COMMENT, media: { id: 'media-1', media_product_type: 'REELS' } });
    expect(deps.contentMedia.capture).not.toHaveBeenCalled();
    expect(deps.runner.run).not.toHaveBeenCalled();
  });

  it('drops a comment Meta sent again', async () => {
    const { service, deps } = setup({ saved: null });
    await service.handleComment('ig-shop', COMMENT);
    expect(deps.runner.run).not.toHaveBeenCalled();
  });

  it("marks the reply failed and skips the public reply when the private reply can't be sent", async () => {
    const { service, deps, fetchMock } = setup({ sendFails: true });
    await service.handleComment('ig-shop', COMMENT);
    expect(deps.db.query).toHaveBeenCalledWith(expect.stringContaining("delivery_status = 'failed'"), [['m-welcome', 'm-reply']]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('leaves the reply to the DM poller when the conversation is already being answered', async () => {
    const { service, deps } = setup({ result: runResult({ status: 'busy', messages: [] }) });
    await service.handleComment('ig-shop', COMMENT);
    expect(deps.db.query).toHaveBeenCalledWith(expect.stringContaining('reply_due_at'), ['conv-1', 2]);
    expect(deps.sender.sendText).not.toHaveBeenCalled();
  });
});
