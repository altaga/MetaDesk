"use client";

import { useCopy } from "@/ui/CopyCode";
import { Icon } from "@/ui/Icon";

type Step = { title: string; body: string; commands?: string[]; note?: string };

/** The whole path from a bare Jetson to a paired board. Nothing skipped. */
const STEPS: Step[] = [
  {
    title: "Prepare the Jetson",
    body: "A Jetson on JetPack (Ubuntu) with Python 3.11 or newer, on a network that can reach the internet. Install Ollama for the on-board model.",
    commands: ["curl -fsSL https://ollama.com/install.sh | sh"],
    note: "Then pull the local model you will name in OLLAMA_MODEL.",
  },
  {
    title: "Put MetaDesk on the board",
    body: "Copy the repository to the board. The paths below assume ~/metadesk.",
    commands: ["git clone <your-metadesk-repo> ~/metadesk"],
  },
  {
    title: "Configure the board API",
    body: "Start from the template, then set JWT_SECRET, DESK_ROOT (the folder the desk may touch), OLLAMA_MODEL and LLM_MODE.",
    commands: [
      "cd ~/metadesk/apps/api && cp .env.example .env",
      "python3 -c \"import secrets; print(secrets.token_hex(32))\"",
    ],
    note: "With the cloud Worker, leave META_API_KEY empty here: the key lives in the Worker, never on the board.",
  },
  {
    title: "Install the board API",
    body: "Its own virtual environment. The browser extras are optional and only needed for Preview.",
    commands: [
      "python3 -m venv .venv && .venv/bin/pip install -r requirements.txt",
      ".venv/bin/pip install -r requirements-browser.txt && .venv/bin/playwright install chromium",
    ],
  },
  {
    title: "Install the agent and pair",
    body: "The agent dials out to the relay, so the board opens no inbound port. It prints an 8-character code; enter it in Fleet, under Pair a new board.",
    commands: [
      "cd ~/metadesk/apps/board-agent && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt",
      ".venv/bin/python -m metadesk_agent pair",
    ],
  },
  {
    title: "Keep both running",
    body: "Run the API and the agent as two systemd services, each from its own virtual environment, with Restart=always. Then they survive reboots and dropped links.",
    commands: ["sudo systemctl enable --now metadesk-api metadesk-agent"],
    note: "You write the two unit files once; they are not generated for you yet.",
  },
];

function Command({ text }: { text: string }) {
  const { copied, copy } = useCopy(text);
  return (
    <div className="ml-code">
      <code>{text}</code>
      <button
        type="button"
        className="ml-code__copy"
        onClick={() => void copy()}
        aria-label={copied ? "Copied" : "Copy command"}
        title={copied ? "Copied" : "Copy command"}
      >
        <Icon name={copied ? "check" : "copy"} size={18} />
      </button>
    </div>
  );
}

export function SetupGuide() {
  return (
    <ol className="ml-setup">
      {STEPS.map((step, index) => (
        <li key={step.title} className="ml-setup__step">
          <span className="ml-setup__n" aria-hidden="true">
            {index + 1}
          </span>
          <div className="ml-setup__body">
            <h3>{step.title}</h3>
            <p>{step.body}</p>
            {step.commands?.map((command) => (
              <Command key={command} text={command} />
            ))}
            {step.note ? <p className="ml-setup__note">{step.note}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
