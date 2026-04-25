import { DisplayedTurn } from './types';

export function MessageBubble({ turn }: { turn: DisplayedTurn }) {
  // Handoff banner — system-style, centered, no bubble.
  if (turn.isHandoff) {
    return (
      <div className="flex justify-center demo-msg-in">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-gray-100 text-gray-500 text-xs">
          <span aria-hidden>👤</span>
          <span>{turn.text}</span>
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
        {images.length >= 2 && (
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
