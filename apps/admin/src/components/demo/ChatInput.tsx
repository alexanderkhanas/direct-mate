import { Send } from 'lucide-react';

interface ChatInputProps {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  disabled?: boolean;
}

export function ChatInput({ value, onChange, onSend, disabled = false }: ChatInputProps) {
  const canSend = !disabled && value.trim().length > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (canSend) onSend();
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="border-t border-gray-100 bg-white px-3 py-2.5 flex items-center gap-2"
    >
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder={
          disabled ? 'Сценарій активний' : 'Напишіть повідомлення...'
        }
        className={`flex-1 min-w-0 border rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-2 ${
          disabled
            ? 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed placeholder:text-gray-400'
            : 'bg-gray-50 border-gray-200 focus:ring-gray-900/10 focus:border-gray-300'
        }`}
      />
      <button
        type="submit"
        disabled={!canSend}
        aria-label="Send"
        className={`h-9 w-9 shrink-0 rounded-full flex items-center justify-center transition-colors ${
          canSend
            ? 'bg-gray-900 text-white hover:bg-gray-800'
            : 'bg-gray-100 text-gray-300 cursor-not-allowed'
        }`}
      >
        <Send className="h-4 w-4" />
      </button>
    </form>
  );
}
