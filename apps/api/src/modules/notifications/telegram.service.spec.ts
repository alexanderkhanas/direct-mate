import { TelegramService } from './telegram.service';

function setup(chatIds: string[] = ['111']) {
  const calls: Array<{ method: string; body: unknown }> = [];
  global.fetch = jest.fn(async (url: string, init: RequestInit) => {
    const method = String(url).split('/').pop()!;
    calls.push({ method, body: init.body instanceof FormData ? init.body : JSON.parse(String(init.body)) });
    return { ok: true, status: 200, text: async () => '' };
  }) as never;
  const config = { get: (key: string) => (key === 'telegram.botToken' ? 'token' : undefined) };
  const storeConfigs = { findOne: async () => ({ handoffConfig: { telegramChatIds: chatIds } }) };
  const service = new TelegramService(config as never, {} as never, storeConfigs as never);
  return { service, calls };
}

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
});

describe('TelegramService: questions with buttons', () => {
  it('sends a question with one row of buttons to every chat the store connected', async () => {
    const { service, calls } = setup(['111', '222']);
    const sent = await service.askTenant('t1', {
      text: 'У сторіс саме цей товар?',
      buttons: [
        { text: 'Так, це він', data: 'cl:l1:y' },
        { text: 'Ні', data: 'cl:l1:n' },
      ],
    });
    expect(sent).toBe(2);
    expect(calls.map((c) => c.method)).toEqual(['sendMessage', 'sendMessage']);
    expect(calls[0].body).toEqual({
      chat_id: '111',
      text: 'У сторіс саме цей товар?',
      reply_markup: { inline_keyboard: [[{ text: 'Так, це він', callback_data: 'cl:l1:y' }, { text: 'Ні', callback_data: 'cl:l1:n' }]] },
    });
  });

  it("passes a tap to its prefix's handler, answers it and replaces the buttons with the outcome", async () => {
    const { service, calls } = setup();
    const handler = jest.fn(async () => '✅ Підтверджено.');
    service.onCallback('cl', handler);

    await service.handleCallback({
      id: 'q1',
      data: 'cl:l1:y',
      message: { message_id: 7, chat: { id: 111 }, caption: 'У сторіс саме цей товар?', photo: [{}] },
    });

    expect(handler).toHaveBeenCalledWith('cl:l1:y', '111');
    expect(calls).toEqual([
      { method: 'answerCallbackQuery', body: { callback_query_id: 'q1', text: '✅ Підтверджено.' } },
      { method: 'editMessageCaption', body: { chat_id: '111', message_id: 7, caption: 'У сторіс саме цей товар?\n\n✅ Підтверджено.' } },
    ]);
  });

  it('only answers a tap its handler refused, or one nobody handles, leaving the message as it is', async () => {
    const { service, calls } = setup();
    service.onCallback('cl', async () => null);
    await service.handleCallback({ id: 'q1', data: 'cl:l1:y', message: { message_id: 7, chat: { id: 999 }, text: 'Питання' } });
    await service.handleCallback({ id: 'q2', data: 'other:x', message: { message_id: 8, chat: { id: 111 }, text: 'Питання' } });
    expect(calls).toEqual([
      { method: 'answerCallbackQuery', body: { callback_query_id: 'q1' } },
      { method: 'answerCallbackQuery', body: { callback_query_id: 'q2' } },
    ]);
  });
});
