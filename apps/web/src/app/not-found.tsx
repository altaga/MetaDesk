import Link from "next/link";

export default function NotFound() {
  return (
    <main className="md-auth">
      <section className="md-card md-auth__card" style={{ textAlign: "center" }}>
        <p className="md-mono" style={{ color: "var(--md-text-3)" }}>
          404
        </p>
        <h1 style={{ fontSize: "1.3rem", margin: "6px 0 12px" }}>Nothing lives at this path</h1>
        <p className="md-auth__sub">Head back to the overview or open the desk.</p>
        <div className="md-cta-row" style={{ justifyContent: "center" }}>
          <Link href="/" className="md-btn">
            Overview
          </Link>
          <Link href="/login" className="md-btn md-btn--primary">
            Open the desk
          </Link>
        </div>
      </section>
    </main>
  );
}
