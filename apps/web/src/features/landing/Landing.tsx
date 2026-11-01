import Link from "next/link";
import { SetupGuide } from "@/features/landing/SetupGuide";
import { Showcase } from "@/features/landing/Showcase";
import { BrandMark } from "@/ui/BrandMark";
import { Icon } from "@/ui/Icon";

const TIERS = [
  {
    name: "Local",
    model: "on-board model",
    body: "A small open model served by Ollama on the Jetson. Routing, short answers and summaries — free and offline.",
    meta: "On the Jetson · $0",
  },
  {
    name: "Fast",
    model: "muse-spark-1.3",
    body: "The everyday cloud tier. A good default for coding and longer reasoning.",
    meta: "Cloud · metered",
  },
  {
    name: "Heavy",
    model: "muse-wonder-1.0",
    body: "The deep tier: a wide context and the hardest turns when they come up.",
    meta: "Cloud · metered",
  },
  {
    name: "Ultra",
    model: "muse-wonder-full-1.0",
    body: "Reserved for a Muse subscription. Same desk, the largest Muse brain.",
    meta: "Subscription",
  },
];

const STRIP = [
  { model: "local model", where: "on the board · Ollama" },
  { model: "muse-spark-1.3", where: "Meta Model API" },
  { model: "muse-wonder-1.0", where: "Meta Model API" },
  { model: "muse-wonder-full-1.0", where: "Muse subscription" },
];

const WHY = [
  {
    tag: "Edge and cloud",
    title: "Local processing, with Muse on call",
    body: "A small open model runs on the Jetson and takes the routing, short answers and summaries. Muse Spark and Muse Wonder are only called when a turn needs them.",
    result: "Easy turns are instant, free and work offline. The cloud bill only grows with the hard work, and a daily budget caps it.",
  },
  {
    tag: "A real machine",
    title: "Muse gets hardware to act on",
    body: "Muse is built for coding across repositories, long-running agents and computer use. On the Jetson those tools run for real: a PTY shell, the desk's files and the board's own Chromium.",
    result: "The model is not guessing at a sandbox. It runs commands, reads files and drives a browser on the machine you own.",
  },
  {
    tag: "Your data",
    title: "Files, memory and secrets stay on the board",
    body: "The desk root, shared memory, experts, jobs and the secrets vault live in the board's own storage. Only a turn routed to a cloud tier leaves it, and local-only mode keeps everything home.",
    result: "You decide what is ever sent to a cloud model, instead of uploading a whole workspace to find out.",
  },
  {
    tag: "Always on, nothing exposed",
    title: "A box on your desk that keeps working",
    body: "The agent dials out to a relay, so the board opens no inbound port. The Meta API key stays in the Worker, and the board holds only a device token.",
    result: "Jobs and missions keep running with your laptop closed, and there is no port forwarding or exposed key to manage.",
  },
];

const STEPS = [
  {
    tag: "Pair",
    title: "Plug the board in and claim it",
    body: "Start the agent on the Jetson. It shows a short code; claim it from Fleet and the board joins your account.",
  },
  {
    tag: "Route",
    title: "Let the ladder pick the rung",
    body: "Each turn is scored first. Light work stays local, hard work climbs, and a daily budget stops the cloud rungs.",
  },
  {
    tag: "Run",
    title: "Drive the machine from chat",
    body: "Files, a real terminal, background agents and parallel missions — all on the board, all behind approval gates.",
  },
];

export function Landing({ signedIn = false }: { signedIn?: boolean }) {
  return (
    <div className="ml">
      <header className="ml-nav">
        <Link href="/" className="ml-nav__brand" aria-label="MetaDesk home">
          <BrandMark />
        </Link>
        <nav className="ml-nav__links" aria-label="Sections">
          <a href="#why">Why a Jetson</a>
          <a href="#models">Models</a>
          <a href="#features">Features</a>
          <a href="#how">How it works</a>
        </nav>
        <div className="ml-nav__actions">
          {signedIn ? (
            <Link href="/dashboard" className="ml-pill ml-pill--blue">
              Dashboard
            </Link>
          ) : (
            <>
              <Link href="/login" className="ml-pill ml-pill--quiet">
                Sign in
              </Link>
              <Link href="/login" className="ml-pill ml-pill--blue">
                Open the desk
              </Link>
            </>
          )}
        </div>
      </header>

      <main>
        <section className="ml-hero">
          <p className="ml-eyebrow">Built on Meta Muse</p>
          <h1 className="ml-hero__title">
            {signedIn ? "Welcome back." : "Muse, running on your hardware."}
          </h1>
          <p className="ml-hero__lede">
            MetaDesk gives Meta&apos;s Muse models a real machine to work on: a Jetson on your desk, with
            files, a shell, a browser and memory. Light work is processed locally; Muse Spark and Muse
            Wonder take the hard turns through the Meta Model API.
          </p>
          <div className="ml-hero__cta">
            <Link href={signedIn ? "/dashboard" : "/login"} className="ml-pill ml-pill--blue ml-pill--lg">
              {signedIn ? "Open the dashboard" : "Open the desk"}
            </Link>
            <a href="#why" className="ml-pill ml-pill--soft ml-pill--lg">
              How it runs
            </a>
          </div>
          <ul className="ml-strip" aria-label="Muse models used">
            {STRIP.map((item) => (
              <li key={item.model}>
                <code>{item.model}</code>
                <span>{item.where}</span>
              </li>
            ))}
          </ul>
        </section>

        <section id="why" className="ml-section" aria-labelledby="why-title">
          <div className="ml-section__head">
            <h2 id="why-title">Why Muse on a Jetson.</h2>
            <p>
              Each part of the setup does the job it is best placed for. Here is what that means in
              practice, so you can judge it for yourself.
            </p>
          </div>
          <ul className="ml-why">
            {WHY.map((item) => (
              <li key={item.tag} className="ml-why__card">
                <span className="ml-tag">{item.tag}</span>
                <h3>{item.title}</h3>
                <p className="ml-why__muse">{item.body}</p>
                <div className="ml-why__here">
                  <span>What you get</span>
                  <p>{item.result}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section id="models" className="ml-section" aria-labelledby="models-title">
          <div className="ml-section__head">
            <h2 id="models-title">One ladder, four rungs</h2>
            <p>
              The desk picks a rung on its own, or you pin one from the composer. Cloud rungs go through the
              Meta Model API with the key kept in the Worker, never on the board or in the browser. Cost is
              metered per turn, and they stop the moment the day&apos;s budget is spent.
            </p>
          </div>
          <ul className="ml-models" tabIndex={0} aria-label="Model tiers">
            {TIERS.map((tier, index) => (
              <li key={tier.model} className="ml-model">
                <div className={`ml-model__art ml-model__art--${index + 1}`} aria-hidden="true">
                  <span>{index + 1}</span>
                </div>
                <span className="ml-tag">{tier.name}</span>
                <h3>{tier.model}</h3>
                <p>{tier.body}</p>
                <span className="ml-model__meta">{tier.meta}</span>
              </li>
            ))}
          </ul>
        </section>

        <section id="features" className="ml-section" aria-labelledby="features-title">
          <div className="ml-section__head">
            <h2 id="features-title">Built to run on the machine</h2>
            <p>The model gets reach, and every reach has a fence around it.</p>
          </div>
          <Showcase />
        </section>

        <section id="setup" className="ml-section ml-setup-section" aria-labelledby="setup-title">
          <div className="ml-section__head">
            <h2 id="setup-title">Setting up a board</h2>
            <p>
              It takes a few steps, not one command. This is the whole path from a bare Jetson to a paired
              board, nothing skipped.
            </p>
          </div>
          <SetupGuide />
        </section>

        <section id="how" className="ml-section" aria-labelledby="how-title">
          <div className="ml-section__head">
            <h2 id="how-title">How it works</h2>
          </div>
          <ul className="ml-steps">
            {STEPS.map((step) => (
              <li key={step.tag} className="ml-step">
                <span className="ml-tag">{step.tag}</span>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
                <Link href={signedIn ? "/dashboard" : "/login"} className="ml-pill ml-pill--blue">
                  Open the desk <Icon name="arrow" size={16} />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="ml-foot">
        <span>MetaDesk — an operator desk for Muse models.</span>
        <span className="md-mono">board · gateway · cloud</span>
      </footer>
    </div>
  );
}
