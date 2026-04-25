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

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} demo-msg-in`}>
      <div className={`max-w-[80%] ${isUser ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
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
        {turn.imageUrls?.map((url) => (
          <img
            key={url}
            src={url}
            alt=""
            className="rounded-2xl max-w-[220px] w-full h-auto object-cover border border-gray-100 bg-gray-50"
            loading="lazy"
          />
        ))}
      </div>
    </div>
  );
}
