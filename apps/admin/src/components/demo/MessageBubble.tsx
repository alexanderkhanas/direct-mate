import { ShieldAlert, BellRing, Send, Bookmark, Copy, User } from 'lucide-react';
import { DisplayedTurn } from './types';

interface MessageBubbleProps {
  turn: DisplayedTurn;
  /** Brand display name (e.g., "StyleBoutique UA"). Used to derive the
   * Instagram-style handle shown in the post-reply preview header. */
  brandName?: string;
}

/** Derive an Instagram-style handle from a brand display name.
 * "StyleBoutique UA" → "styleboutique.ua"; "Glow Cosmetics" → "glow.cosmetics" */
function brandToHandle(brand: string | undefined): string {
  if (!brand) return 'store';
  return brand
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .split(/\s+/)
    .join('.');
}

export function MessageBubble({ turn, brandName }: MessageBubbleProps) {
  // Handoff system card — two lines explaining both that the bot stopped
  // AND that the manager has been notified in Telegram. Demo-only marketing
  // affordance: prospective customer evaluating the bot wants to see how
  // escalation looks.
  //
  // It does NOT duplicate the bot's own message. Handoffs now announce
  // themselves in the reply ("Передаю розмову менеджеру…" — see the handoff
  // rule in CLAUDE.md), which is what a real Instagram customer would read;
  // this card is the demo's annotation layer on top, showing the prospect the
  // part a customer never sees — the Telegram ping reaching a human.
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
  const igContext = turn.instagramContext;

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} demo-msg-in`}>
      <div className={`max-w-[80%] ${isUser ? 'items-end' : 'items-start'} flex flex-col gap-1.5`}>
        {/* Instagram STORY reply context — compact "You replied to their story"
            label + small portrait preview with duration bar. Sized to match
            real IG DM proportions (~140px wide, smaller than the post card). */}
        {igContext && isUser && igContext.type === 'story' && (
          <div className="flex flex-col items-end gap-1.5">
            <span className="text-[11px] text-gray-400 px-1">
              You replied to their story
            </span>
            <div className="overflow-hidden rounded-2xl bg-gray-100 border border-gray-100 w-[140px] aspect-[3/4]">
              <img
                src={igContext.mediaUrl}
                alt="Customer Instagram story reference"
                className="w-full h-full object-cover"
                loading="lazy"
              />
            </div>
          </div>
        )}

        {/* Instagram POST reply context — full IG post chrome:
            dark header (avatar + handle), product image, carousel indicator
            top-right, Send/Bookmark action icons floating to the left. */}
        {igContext && isUser && igContext.type === 'post' && (
          <div className="flex items-center gap-2.5">
            <div className="flex flex-col gap-2">
              <div className="w-9 h-9 rounded-full bg-gray-700/90 flex items-center justify-center">
                <Send className="h-4 w-4 text-white" strokeWidth={2} />
              </div>
              <div className="w-9 h-9 rounded-full bg-gray-700/90 flex items-center justify-center">
                <Bookmark className="h-4 w-4 text-white" strokeWidth={2} />
              </div>
            </div>
            <div className="flex flex-col w-[200px] rounded-2xl overflow-hidden shadow-sm">
              <div className="bg-gray-800 px-3 py-2 flex items-center gap-2">
                <div className="w-7 h-7 rounded-full bg-gray-600 flex items-center justify-center shrink-0">
                  <User className="h-4 w-4 text-gray-400" strokeWidth={2} />
                </div>
                <span className="text-white text-[13px] font-medium truncate">
                  {brandToHandle(brandName)}
                </span>
              </div>
              <div className="relative bg-white aspect-[3/4]">
                <img
                  src={igContext.mediaUrl}
                  alt={`${brandName} Instagram post reference`}
                  className="w-full h-full object-contain"
                  loading="lazy"
                />
                <Copy className="absolute top-2 right-2 h-4 w-4 text-white drop-shadow-md" strokeWidth={2.5} />
              </div>
            </div>
          </div>
        )}
        {/* Images render first, in Instagram-DM stacked layout for 2+ */}
        {images.length === 1 && (
          <img
            src={images[0]}
            alt="Product variant"
            className="rounded-3xl max-w-[220px] w-full h-auto object-cover border border-gray-100 bg-gray-50"
            loading="lazy"
          />
        )}
        {images.length === 2 && (
          <div className="relative w-[240px] h-[300px]">
            <img
              src={images[0]}
              alt="Product variant 1 of 2"
              className="absolute top-0 left-0 w-[170px] h-[220px] rounded-3xl object-cover border-2 border-white shadow-md bg-gray-50"
              loading="lazy"
            />
            <img
              src={images[1]}
              alt="Product variant 2 of 2"
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
                alt={`Product variant ${i + 1}`}
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
                ? 'bg-violet-600 text-white px-4 py-2 rounded-3xl text-sm leading-relaxed whitespace-pre-wrap'
                : 'bg-gray-100 text-gray-900 px-4 py-2 rounded-3xl text-sm leading-relaxed whitespace-pre-wrap'
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
