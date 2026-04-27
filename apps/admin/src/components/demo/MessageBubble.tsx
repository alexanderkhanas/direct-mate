import { ShieldAlert, BellRing } from 'lucide-react';
import { DisplayedTurn } from './types';

export function MessageBubble({ turn }: { turn: DisplayedTurn }) {
  // Handoff system card — two lines explaining both that the bot stopped
  // AND that the manager has been notified in Telegram. Demo-only marketing
  // affordance: prospective customer evaluating the bot wants to see how
  // escalation looks. (Production Instagram silent-handoff invariant is
  // unaffected — the bot's reply text upstream stays neutral; this card is
  // a frontend-only system annotation, not part of the engine reply.)
  if (turn.isHandoff) {
    return (
      <div className="flex justify-center demo-msg-in">
        <div className="max-w-[85%] rounded-2xl bg-amber-50 border border-amber-200 px-4 py-3">
          <div className="flex items-center gap-2 text-[12px] font-semibold text-amber-900">
            <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>Бот зупинив розмову</span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-amber-700 mt-1">
            <BellRing className="h-3 w-3 shrink-0" aria-hidden />
            <span>Менеджер отримав сповіщення в Telegram</span>
          </div>
        </div>
      </div>
    );
  }

  const isUser = turn.role === 'user';
  const images = turn.imageUrls ?? [];

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} demo-msg-in`}>
      <div className={`max-w-[80%] ${isUser ? 'items-end' : 'items-start'} flex flex-col gap-1.5`}>
        {/* Images render first, in Instagram-DM stacked layout for 2+ */}
        {images.length === 1 && (
          <img
            src={images[0]}
            alt=""
            className="rounded-3xl max-w-[220px] w-full h-auto object-cover border border-gray-100 bg-gray-50"
            loading="lazy"
          />
        )}
        {images.length === 2 && (
          <div className="relative w-[240px] h-[300px]">
            <img
              src={images[0]}
              alt=""
              className="absolute top-0 left-0 w-[170px] h-[220px] rounded-3xl object-cover border-2 border-white shadow-md bg-gray-50"
              loading="lazy"
            />
            <img
              src={images[1]}
              alt=""
              className="absolute bottom-0 right-0 w-[170px] h-[220px] rounded-3xl object-cover border-2 border-white shadow-md bg-gray-50"
              loading="lazy"
            />
          </div>
        )}
        {images.length >= 3 && (
          <div className="grid grid-cols-2 gap-2 w-[260px]">
            {images.slice(0, 4).map((src, i) => (
              <img
                key={i}
                src={src}
                alt=""
                className="rounded-2xl object-cover w-full h-[140px] border border-gray-100 bg-gray-50"
                loading="lazy"
              />
            ))}
          </div>
        )}
        {turn.text && (
          <div
            className={
              isUser
                ? 'bg-gray-900 text-white px-3.5 py-2 rounded-2xl rounded-br-sm text-sm leading-relaxed whitespace-pre-wrap'
                : 'bg-gray-100 text-gray-900 px-3.5 py-2 rounded-2xl rounded-bl-sm text-sm leading-relaxed whitespace-pre-wrap'
            }
          >
            {turn.text}
          </div>
        )}
        {turn.aggregatedHint && (
          <p className="text-[11px] italic text-gray-400 px-1">
            💬 Об'єднано в одну відповідь
          </p>
        )}
      </div>
    </div>
  );
}
