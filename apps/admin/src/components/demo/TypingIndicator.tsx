export function TypingIndicator() {
  return (
    <div className="flex justify-start demo-msg-in">
      <div className="bg-gray-100 text-gray-400 px-4 py-3 rounded-2xl rounded-bl-sm flex items-center gap-1">
        <span className="demo-typing-dot inline-block h-1.5 w-1.5 rounded-full bg-gray-400" />
        <span className="demo-typing-dot inline-block h-1.5 w-1.5 rounded-full bg-gray-400" />
        <span className="demo-typing-dot inline-block h-1.5 w-1.5 rounded-full bg-gray-400" />
      </div>
    </div>
  );
}
