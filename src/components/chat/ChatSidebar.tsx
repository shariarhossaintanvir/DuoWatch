import React, { useState, useRef, useEffect } from 'react';
import { useCinema } from '../../context/CinemaContext';
import { EmojiReactions } from './EmojiReactions';
import { Send, MessageSquare, Shield, X, Bell } from 'lucide-react';

interface ChatSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ChatSidebar: React.FC<ChatSidebarProps> = ({ isOpen, onClose }) => {
  const { chatMessages, sendMessage, myParticipantId } = useCinema();
  const [inputText, setInputText] = useState<string>('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to latest message
  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatMessages, isOpen]);

  // Handle Escape key to close chat on small screens
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen && window.innerWidth < 1024) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    sendMessage(inputText);
    setInputText('');
  };

  const formatTimestamp = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Mobile / Tablet Backdrop (< lg) */}
      <div 
        onClick={onClose}
        className="lg:hidden fixed inset-0 bg-black/60 z-40 transition-opacity"
        aria-hidden="true"
      />

      {/* Chat Container: Slide-over drawer on < lg, docked column on >= lg */}
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-xs sm:w-80 lg:relative lg:inset-auto lg:z-20 h-full flex flex-col bg-[#14161d] border-l border-[#282d3c] shadow-xl">
        {/* Header */}
        <div className="p-3.5 border-b border-[#282d3c] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-amber-400" />
            <h3 className="text-sm font-semibold text-gray-200">Room Chat</h3>
          </div>
          <button
            onClick={onClose}
            aria-label="Close Chat"
            className="text-gray-400 hover:text-gray-200 p-1.5 rounded-lg hover:bg-[#1c1f2a] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Messages Scroll Area */}
        <div className="flex-1 overflow-y-auto p-3.5 space-y-3 min-h-0">
          {chatMessages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center p-4 text-gray-500">
              <MessageSquare className="w-8 h-8 text-gray-600 mb-2" />
              <p className="text-xs">No messages yet.</p>
              <p className="text-[11px] text-gray-600 mt-1">
                Send a message to your partner
              </p>
            </div>
          ) : (
            chatMessages.map((msg) => {
              const isMe = msg.senderId === myParticipantId;

              if (msg.isSystem) {
                return (
                  <div key={msg.id} className="flex items-center gap-1.5 justify-center my-2">
                    <Bell className="w-3 h-3 text-amber-500/70" />
                    <span className="text-[11px] text-gray-400 bg-[#0b0c10]/60 px-2.5 py-0.5 rounded-md border border-[#282d3c]">
                      {msg.text}
                    </span>
                  </div>
                );
              }

              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
                >
                  <div className="flex items-center gap-1.5 mb-1 px-1">
                    <span className="text-[11px] font-medium text-gray-300">
                      {msg.senderName}
                    </span>
                    <span
                      className={`text-[9px] px-1.5 py-0.2 rounded font-semibold uppercase ${
                        msg.role === 'owner'
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                          : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      }`}
                    >
                      {msg.role === 'owner' ? 'Host' : 'Partner'}
                    </span>
                    <span className="text-[10px] text-gray-500 font-mono">
                      {formatTimestamp(msg.timestamp)}
                    </span>
                  </div>

                  <div
                    className={`px-3 py-2 rounded-lg text-xs max-w-[85%] break-words leading-relaxed ${
                      isMe
                        ? 'bg-amber-500 text-black font-medium'
                        : 'bg-[#1c1f2a] text-gray-200 border border-[#282d3c]'
                    }`}
                  >
                    {msg.text}
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Emoji Reactions Toolbar */}
        <div className="px-3 pt-2 border-t border-[#282d3c]/60 bg-[#0e1015]/60 shrink-0">
          <EmojiReactions />
        </div>

        {/* Input Field */}
        <form onSubmit={handleSend} className="p-3 bg-[#0e1015] border-t border-[#282d3c] flex items-center gap-2 shrink-0">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Type message to partner..."
            className="flex-1 bg-[#1c1f2a] text-xs text-gray-200 placeholder-gray-500 px-3 py-2 rounded-lg border border-[#282d3c] focus:outline-none focus:border-amber-500/50 min-w-0"
          />
          <button
            type="submit"
            disabled={!inputText.trim()}
            aria-label="Send message"
            className="bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black p-2 rounded-lg transition-colors shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </form>

        {/* Privacy Notice Footer */}
        <div className="py-1.5 px-3 bg-[#0b0c10] border-t border-[#282d3c]/50 flex items-center justify-center gap-1.5 text-[10px] text-gray-500 shrink-0">
          <Shield className="w-3 h-3 text-emerald-500/80" />
          <span>Direct WebRTC P2P | In-Memory Ephemeral Chat</span>
        </div>
      </div>
    </>
  );
};
