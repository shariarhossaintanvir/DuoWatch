import React from 'react';
import { useCinema } from '../../context/CinemaContext';

const CINEMA_EMOJIS = ['🍿', '❤️', '😂', '👏', '😮', '🔥', '🎬', '🥂', '😱', '🎉'];

export const EmojiReactions: React.FC = () => {
  const { sendReaction } = useCinema();

  return (
    <div className="flex items-center gap-1 overflow-x-auto py-1 px-1 scrollbar-none">
      {CINEMA_EMOJIS.map((emoji) => (
        <button
          key={emoji}
          onClick={() => sendReaction(emoji)}
          className="hover:scale-125 active:scale-95 text-lg p-1.5 rounded-lg hover:bg-[#1c1f2a] transition-all shrink-0 select-none"
          title={`React with ${emoji}`}
        >
          {emoji}
        </button>
      ))}
    </div>
  );
};
