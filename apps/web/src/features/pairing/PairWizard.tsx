"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Icon } from "@/ui/Icon";
import {
  boardHost,
  configureBoard,
  findLocalBoards,
  needsLocalNetworkPermission,
  probeBoard,
  type FoundBoard,
  type SetupStatus,
} from "./localBoard";

type Step = "scan" | "form" | "code";

const STEPS: Array<{ id: Step; label: string; detail: string }> = [
  { id: "scan", label: "Discover", detail: "Find the unpaired Jetson on the USB cable." },
  { id: "form", label: "Setup", detail: "Name it, set a board password and its Wi-Fi." },
  { id: "code", label: "Pair ID", detail: "The board asks for a code. Confirm it here." },
];

/**
 * Board setup, inside Fleet: find an unpaired board on this machine, give it a
 * name, a password and its Wi-Fi, then confirm the Pair ID the board asked the
 * cloud for. No terminal on the board.
 */
export function PairWizard({ onExit }: { onExit: () => void }) {
  const [step, setStep] = useState<Step>("scan");
  const [scanning, setScanning] = useState(true);
  const [boards, setBoards] = useState<FoundBoard[]>([]);
  const [picked, setPicked] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", password: "", wifiSsid: "", wifiPassword: "" });
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [claimed, setClaimed] = useState(false);
  const [enrolled, setEnrolled] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = boards.find((row) => row.base === picked) ?? null;
  // What still stands between the operator and Next, said in words.
  const missing = [
    form.name.trim() ? "" : "a board name",
    form.password.length >= 4 ? "" : "a board password of at least 4 characters",
    form.wifiSsid.trim() ? "" : "the Wi-Fi name",
  ].filter(Boolean);
  const canNext = missing.length === 0;
  const stepIndex = STEPS.findIndex((item) => item.id === step);

  // Each step starts at the top, with the stepper in view.
  useEffect(() => {
    document.querySelector(".md-main")?.scrollTo({ top: 0 });
  }, [step]);

  const scan = useCallback(async () => {
    setScanning(true);
    setError(null);
    const found = await findLocalBoards();
    setBoards(found);
    setPicked(found[0]?.base ?? null);
    setScanning(false);
  }, []);

  useEffect(() => {
    void scan();
  }, [scan]);

  // After the operator confirms, wait for the board to pick up its token.
  useEffect(() => {
    if (!claimed || enrolled || !selected) return;
    const timer = window.setInterval(async () => {
      const row = await probeBoard(selected.base);
      // The board stops answering /setup once it is paired and dials out.
      if (!row || row.status.paired) setEnrolled(true);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [claimed, enrolled, selected]);

  function patch(partial: Partial<typeof form>) {
    setForm((prev) => ({ ...prev, ...partial }));
    setError(null);
  }

  function toSetup() {
    if (!selected) return;
    setForm((prev) => ({ ...prev, name: prev.name || selected.status.name }));
    setError(null);
    setStep("form");
  }

  async function submitForm(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || !canNext || busy) return;
    setBusy(true);
    setError(null);
    try {
      const next = await configureBoard(selected.base, {
        name: form.name.trim(),
        password: form.password,
        wifi_ssid: form.wifiSsid.trim(),
        wifi_password: form.wifiPassword,
      });
      setStatus(next);
      setClaimed(false);
      setStep("code");
      if (!next.code) setError("The board did not return a Pair ID. Go back and try again.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not set up the board.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmCode() {
    const code = status?.code;
    if (!code || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.claimPairing(code);
      setClaimed(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The Pair ID could not be confirmed.");
    } finally {
      setBusy(false);
    }
  }

  function back() {
    setError(null);
    setStep(step === "code" ? "form" : "scan");
  }

  return (
    <section className="md-page md-page--wide md-setup">
      <div className="md-viewhead">
        <div>
          <nav className="md-setup__crumbs" aria-label="Breadcrumb">
            <button type="button" onClick={onExit}>
              Fleet
            </button>
            <span aria-hidden="true">/</span>
            <span>Set up a board</span>
          </nav>
          <h1>Set up a board</h1>
          <p className="md-viewhead__note">
            Plug the Jetson into this computer with the USB cable. No terminal on the board.
          </p>
        </div>
        <ol className="md-setup__stepper" aria-label="Setup steps">
          {STEPS.map((item, index) => (
            <li
              key={item.id}
              data-state={index < stepIndex || enrolled ? "done" : index === stepIndex ? "on" : "todo"}
              aria-current={index === stepIndex ? "step" : undefined}
            >
              <span className="md-setup__dot">{index < stepIndex || enrolled ? <Icon name="check" size={14} /> : index + 1}</span>
              {item.label}
            </li>
          ))}
        </ol>
      </div>

      <div className="md-setup__grid">
        <div className="md-card md-setup__main">
          {step === "scan" ? (
            <>
              <header className="md-setup__head">
                <h2>Discover a board</h2>
                <p>The desk looks for a Jetson on the USB cable that is not paired yet.</p>
              </header>

              {scanning ? (
                <div className="md-setup__scanning">
                  <span className="md-setup__radar" aria-hidden="true" />
                  <span>Looking for boards on the USB cable…</span>
                </div>
              ) : null}

              {!scanning && boards.length ? (
                <fieldset className="md-setup__boards">
                  <legend className="md-sr">Boards found</legend>
                  {boards.map((row) => {
                    const on = picked === row.base;
                    return (
                      <label key={row.base} className="md-setup__board" data-on={on}>
                        <input
                          type="radio"
                          name="board"
                          value={row.base}
                          checked={on}
                          onChange={() => setPicked(row.base)}
                          className="md-sr"
                        />
                        <span className="md-setup__boardicon" aria-hidden="true">
                          <Icon name="board" size={22} />
                        </span>
                        <span className="md-setup__boardtext">
                          <strong>{row.status.name}</strong>
                          <small>
                            {row.status.hostname} · {boardHost(row.base)}
                          </small>
                        </span>
                        <span className="md-chip md-chip--fast">Unpaired</span>
                        <span className="md-setup__radio" aria-hidden="true">
                          {on ? <Icon name="check" size={14} /> : null}
                        </span>
                      </label>
                    );
                  })}
                </fieldset>
              ) : null}

              {!scanning && !boards.length ? (
                <div className="md-setup__empty">
                  <span className="md-setup__emptyicon" aria-hidden="true">
                    <Icon name="board" size={26} />
                  </span>
                  <strong>No unpaired board found</strong>
                  <ul>
                    {needsLocalNetworkPermission() ? (
                      <li>
                        If the browser asked to <strong>access devices on your local network</strong>, choose Allow. If you
                        blocked it, turn it back on in this site&apos;s settings (the icon left of the address).
                      </li>
                    ) : null}
                    <li>The USB cable is connected to this computer, not just to power.</li>
                    <li>The Jetson finished booting (give it a minute after power-on).</li>
                    <li>MetaDesk is installed on the board and not paired yet, or a board-emu container is running.</li>
                  </ul>
                </div>
              ) : null}

              <div className="md-setup__actions">
                <button type="button" className="md-btn md-btn--ghost" onClick={onExit}>
                  Cancel
                </button>
                <div>
                  <button type="button" className="md-btn" onClick={() => void scan()} disabled={scanning}>
                    Scan again
                  </button>
                  <button type="button" className="md-btn md-btn--primary" onClick={toSetup} disabled={scanning || !selected}>
                    Next
                  </button>
                </div>
              </div>
            </>
          ) : null}

          {step === "form" ? (
            <form onSubmit={(event) => void submitForm(event)} noValidate className="md-setup__form">
              <header className="md-setup__head">
                <h2>Set up {selected?.status.name ?? "this board"}</h2>
                <p>A name for the fleet, a board password, and the Wi-Fi it should use.</p>
              </header>

              <div className="md-setup__fields">
                <Field
                  label="Board name"
                  value={form.name}
                  onChange={(v) => patch({ name: v })}
                  disabled={busy}
                  wide
                  hint="This is how it shows in Fleet and in chat."
                />
                <Field
                  label="Board password"
                  type="password"
                  value={form.password}
                  onChange={(v) => patch({ password: v })}
                  disabled={busy}
                  hint="At least 4 characters. Stored on the board as a hash."
                  wide
                />
                <Field
                  label="Wi-Fi name"
                  value={form.wifiSsid}
                  onChange={(v) => patch({ wifiSsid: v })}
                  disabled={busy}
                  hint="The board keeps it for when it joins Wi-Fi."
                />
                <Field
                  label="Wi-Fi password"
                  type="password"
                  value={form.wifiPassword}
                  onChange={(v) => patch({ wifiPassword: v })}
                  disabled={busy}
                />
              </div>
              <p className="md-setup__fine">Wi-Fi is saved with the board. Joining that network is not automated yet.</p>

              {error ? (
                <p className="md-error" role="alert">
                  {error}
                </p>
              ) : null}
              {missing.length && !busy ? (
                <p className="md-setup__fine" aria-live="polite">
                  Still needed: {missing.join(", ")}.
                </p>
              ) : null}
              <div className="md-setup__actions">
                <button type="button" className="md-btn md-btn--ghost" onClick={back} disabled={busy}>
                  Back
                </button>
                <button type="submit" className="md-btn md-btn--primary" disabled={!canNext || busy}>
                  {busy ? "Saving…" : "Next"}
                </button>
              </div>
            </form>
          ) : null}

          {step === "code" ? (
            <>
              <header className="md-setup__head">
                <h2>{enrolled ? "Board enrolled" : "Confirm the Pair ID"}</h2>
                <p>
                  {enrolled
                    ? `${status?.name ?? "The board"} now belongs to this desk. It connects on its own and shows online in Fleet.`
                    : claimed
                      ? "Confirmed. Waiting for the board to pick up its token…"
                      : "This is the code the board asked the cloud for. Confirm it to enroll the board."}
                </p>
              </header>

              {enrolled ? (
                <div className="md-setup__success">
                  <span className="md-setup__successicon" aria-hidden="true">
                    <Icon name="check" size={28} />
                  </span>
                  <strong>{status?.name ?? "Board"} joined the fleet</strong>
                  <span>{selected ? boardHost(selected.base) : ""}</span>
                </div>
              ) : (
                <div className="md-setup__code" role="group" aria-label={`Pair ID ${status?.code ?? ""}`}>
                  {(status?.code ?? "").split("").map((char, index) =>
                    char === "-" ? (
                      <span key={index} className="md-setup__dash" aria-hidden="true">
                        –
                      </span>
                    ) : (
                      <span key={index} className="md-setup__char" aria-hidden="true">
                        {char}
                      </span>
                    ),
                  )}
                </div>
              )}
              {!enrolled ? (
                <p className="md-setup__meta">
                  {status?.name ?? "Board"}
                  {selected ? ` · ${boardHost(selected.base)}` : ""}
                  {claimed ? " · waiting for the board…" : ""}
                </p>
              ) : null}

              {error ? (
                <p className="md-error" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="md-setup__actions">
                {enrolled ? (
                  <>
                    <span />
                    <button type="button" className="md-btn md-btn--primary" onClick={onExit}>
                      Back to Fleet
                    </button>
                  </>
                ) : (
                  <>
                    <button type="button" className="md-btn md-btn--ghost" onClick={back} disabled={busy || claimed}>
                      Back
                    </button>
                    <button
                      type="button"
                      className="md-btn md-btn--primary"
                      onClick={() => void confirmCode()}
                      disabled={busy || claimed || !status?.code}
                    >
                      {busy ? "Confirming…" : claimed ? "Confirmed" : "Confirm"}
                    </button>
                  </>
                )}
              </div>
            </>
          ) : null}
        </div>

        <aside className="md-card md-setup__aside" aria-label="How setup works">
          <h3>How it works</h3>
          <ol className="md-setup__timeline">
            {STEPS.map((item, index) => (
              <li key={item.id} data-state={index < stepIndex || enrolled ? "done" : index === stepIndex ? "on" : "todo"}>
                <span className="md-setup__dot">{index < stepIndex || enrolled ? <Icon name="check" size={14} /> : index + 1}</span>
                <div>
                  <strong>{item.label}</strong>
                  <p>{item.detail}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="md-setup__facts">
            <p>
              <Icon name="fleet" size={16} />
              The board answers setup only on the USB cable, and stops once it is paired.
            </p>
            <p>
              <Icon name="arrow" size={16} />
              After that it only dials out to the relay. Nothing on your network can reach it.
            </p>
          </div>
        </aside>
      </div>
    </section>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: "text" | "password";
  disabled?: boolean;
  hint?: string;
  wide?: boolean;
}) {
  return (
    <label className={`md-field ${props.wide ? "md-setup__wide" : ""}`}>
      <span className="md-label">{props.label}</span>
      <input
        className="md-input"
        type={props.type ?? "text"}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        autoComplete={props.type === "password" ? "new-password" : "off"}
        spellCheck={false}
        disabled={props.disabled}
      />
      {props.hint ? <span className="md-setup__hint">{props.hint}</span> : null}
    </label>
  );
}
