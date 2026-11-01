"use client";

import { useState } from "react";
import { Icon } from "@/ui/Icon";

/**
 * Copy text, falling back to a hidden selection when the Clipboard API is
 * refused (an embedded browser, an insecure origin, no permission).
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      area.remove();
    }
  }
}

/** A copy button's state: it says "Copied" for a moment after a copy lands. */
export function useCopy(text: string) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    if (!(await copyText(text))) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }
  return { copied, copy };
}

/** A command in a code box with a one-click copy. */
export function CopyCode({ command, label = "Copy command" }: { command: string; label?: string }) {
  const { copied, copy } = useCopy(command);

  return (
    <div className="md-copycode">
      <code>{command}</code>
      <button
        type="button"
        className="md-copycode__btn"
        onClick={() => void copy()}
        aria-label={copied ? "Copied" : label}
        title={copied ? "Copied" : label}
      >
        <Icon name={copied ? "check" : "copy"} size={18} />
      </button>
    </div>
  );
}
