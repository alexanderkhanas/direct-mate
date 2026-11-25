// The connect link's pages (/connect, /connect/done): an owner we set the
// store up for allows reading their Direct and connects Instagram, without
// signing in. `en` must have the same keys as `uk`.
const uk = {
  title: 'Підключіть Instagram «{store}»',
  lead: 'Ми прочитаємо ваші діалоги в Direct, щоб побачити, з чим звертаються клієнти, і запропонувати, що може взяти на себе AI-агент.',
  point_read: 'Прочитаємо до 100 останніх діалогів. Групові чати не читаємо.',
  point_redact: 'Перед аналізом прибираємо телефони, імена, адреси й номери карток. З історії зберігаємо лише висновки.',
  point_new: 'Нові повідомлення, що прийдуть після підключення, зберігаються в DirectMate.',
  point_silent: 'Клієнтам нічого не надсилаємо: AI-агент вимкнений.',
  point_revoke: 'Дозвіл можна відкликати будь-коли: напишіть нам.',
  consent: 'Дозволяю DirectMate читати повідомлення в Direct цього акаунта',
  hint: 'Потрібен професійний акаунт (бізнес або автор). Увійдіть саме в той акаунт, діалоги якого аналізуємо.',
  button: 'Підключити Instagram',
  error: 'Не вдалося. Спробуйте ще раз.',
  expired_title: 'Посилання вже не діє',
  expired_text: 'Термін дії минув. Попросіть у нас нове посилання.',
  connected_title: 'Instagram уже підключено',
  connected_text: 'Дякуємо! Більше нічого робити не потрібно.',
  done_title: 'Готово, Instagram підключено',
  done_text: 'Дякуємо! Ми проаналізуємо діалоги й повернемося з пропозицією. Цю сторінку можна закрити.',
  done_error_title: 'Instagram не підключено',
  done_error_cancelled: 'Вхід скасовано. Відкрийте посилання ще раз і спробуйте знову.',
  done_error_no_account: 'Не знайдено акаунта Instagram. Переконайтеся, що акаунт професійний (бізнес або автор), і відкрийте посилання ще раз.',
  done_error_other: 'Не вдалося завершити вхід. Відкрийте посилання ще раз і спробуйте знову.',
};

const en: typeof uk = {
  title: 'Connect «{store}» Instagram',
  lead: 'We’ll read your Direct conversations to see what customers ask about, and propose what an AI agent could take on.',
  point_read: 'We read up to 100 of the latest conversations. Group chats are not read.',
  point_redact: 'Phones, names, addresses and card numbers are removed before the analysis. Only the conclusions from the history are kept.',
  point_new: 'New messages that arrive after connecting are kept in DirectMate.',
  point_silent: 'Nothing is sent to your customers: the AI agent is off.',
  point_revoke: 'You can withdraw this permission at any time: just write to us.',
  consent: 'I allow DirectMate to read the Direct messages of this account',
  hint: 'A professional account (business or creator) is needed. Log in to the account whose conversations we analyse.',
  button: 'Connect Instagram',
  error: 'Something went wrong. Please try again.',
  expired_title: 'This link no longer works',
  expired_text: 'It has expired. Ask us for a new link.',
  connected_title: 'Instagram is already connected',
  connected_text: 'Thank you! There’s nothing more to do.',
  done_title: 'Done, Instagram is connected',
  done_text: 'Thank you! We’ll analyse the conversations and come back with a proposal. You can close this page.',
  done_error_title: 'Instagram is not connected',
  done_error_cancelled: 'The login was cancelled. Open the link again and retry.',
  done_error_no_account: 'No Instagram account was found. Make sure it’s a professional account (business or creator) and open the link again.',
  done_error_other: 'The login could not be completed. Open the link again and retry.',
};

export default { uk, en };
