import { useEffect, useRef, useState } from "react";
import { api } from "../lib/bridge";
import { Icon } from "../components/Icon";
import { AttachmentChip } from "../components/ui";
import { setComposerTyping } from "../lib/companion";

export interface ComposerProps {
  placeholder: string;
  attached: string[];
  sending: boolean;
  onAttach: (paths: string[]) => void;
  onRemove: (path: string) => void;
  onSend: (text: string) => Promise<boolean>;
  /** Stops the reply being written. While one is in flight the Send button becomes Stop. */
  onStop?: () => void;
  /** Pre-fills the box (suggestion chips). `nonce` lets the same text be applied twice. */
  prefill?: { text: string; nonce: number } | null;
}

const TYPING_IDLE_MS = 2500;

export function Composer({ placeholder, attached, sending, onAttach, onRemove, onSend, onStop, prefill }: ComposerProps) {
  const [text, setText] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);
  const typingTimer = useRef<number | undefined>(undefined);

  // Non listens only while text is actually being typed here, not merely while the box has focus.
  const stopTyping = () => {
    window.clearTimeout(typingTimer.current);
    setComposerTyping(false);
  };
  useEffect(() => stopTyping, []);

  useEffect(() => {
    if (prefill) {
      setText(prefill.text);
      area.current?.focus();
    }
  }, [prefill]);

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);

  const canSend = !sending && (text.trim().length > 0 || attached.length > 0);

  async function submit() {
    if (!canSend) return;
    const t = text.trim() || "Please look at these files.";
    stopTyping();
    const ok = await onSend(t);
    if (ok) setText("");
  }

  async function pick() {
    const paths = await api.call("workspace:pick-files", {}).catch(() => []);
    if (paths.length) onAttach(paths);
  }

  return (
    <div className="composer">
      {attached.length > 0 && (
        <div className="attached" aria-label="Files you added">
          {attached.map((p) => (
            <AttachmentChip key={p} path={p} onRemove={() => onRemove(p)} />
          ))}
        </div>
      )}
      <div className="composer-box">
        <button type="button" className="icon-btn" onClick={() => void pick()} aria-label="Add files" title="Add files">
          <Icon name="attachment" size={22} tone="current" />
        </button>
        <textarea
          ref={area}
          rows={1}
          className="composer-input"
          value={text}
          placeholder={placeholder}
          aria-label="Type your message"
          onChange={(e) => {
            setText(e.target.value);
            window.clearTimeout(typingTimer.current);
            if (e.target.value.length > 0) {
              setComposerTyping(true);
              typingTimer.current = window.setTimeout(() => setComposerTyping(false), TYPING_IDLE_MS);
            } else setComposerTyping(false);
          }}
          onBlur={stopTyping}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        {sending && onStop ? (
          <button type="button" className="send-btn stop" onClick={onStop} aria-label="Stop" title="Stop">
            <Icon name="stop" size={22} tone="current" />
          </button>
        ) : (
          <button type="button" className="send-btn" onClick={() => void submit()} disabled={!canSend} aria-label="Send" title="Send (Enter)">
            <Icon name="send" size={20} tone="current" />
          </button>
        )}
      </div>
    </div>
  );
}
