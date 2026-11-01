"use client";

import type { BoardHealth, BoardInfo } from "@/shared/types";

function Metric({
  label,
  value,
  detail,
  percent,
}: {
  label: string;
  value: string;
  detail?: string;
  percent?: number | null;
}) {
  return (
    <article className="md-card md-metric">
      <div className="md-metric__label">{label}</div>
      <div className="md-metric__value">{value}</div>
      {detail ? <div className="md-muted" style={{ fontSize: "0.82rem" }}>{detail}</div> : null}
      {typeof percent === "number" ? (
        <div
          className="md-meter"
          role="meter"
          aria-label={`${label} use`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent)}
        >
          <div className="md-meter__fill" style={{ width: `${Math.min(100, Math.max(0, percent))}%` }} />
        </div>
      ) : null}
    </article>
  );
}

export function BoardView({ info, health }: { info: BoardInfo | null; health: BoardHealth | null }) {
  if (!health) {
    return (
      <div className="md-viewhead">
        <h1>Board</h1>
        <span className="md-muted">Waiting for the first health snapshot…</span>
      </div>
    );
  }

  const gb = (value: number) => `${value.toFixed(1)} GB`;
  // Memory reads better in GB once it passes one.
  const mem = (value: number) => (value >= 1024 ? gb(value / 1024) : `${Math.round(value)} MB`);

  return (
    <>
      <div className="md-viewhead">
        <h1>Board</h1>
        <span className="md-muted">{info ? `${info.hostname} · python ${info.python}` : ""}</span>
      </div>

      <div className="md-metrics" data-guide="health">
        <Metric
          label="CPU"
          value={health.cpu.percent === null ? "—" : `${health.cpu.percent}%`}
          detail={`${health.cpu.count} cores`}
          percent={health.cpu.percent}
        />
        <Metric
          label="Memory"
          value={`${health.ram.percent}%`}
          detail={`${mem(health.ram.used_mb)} of ${mem(health.ram.total_mb)}`}
          percent={health.ram.percent}
        />
        <Metric
          label="Disk"
          value={health.disk ? `${health.disk.percent}%` : "—"}
          detail={health.disk ? `${gb(health.disk.used_gb)} of ${gb(health.disk.total_gb)}` : "desk root unavailable"}
          percent={health.disk?.percent ?? null}
        />
        <Metric
          label="Thermal"
          value={health.temp_c === null ? "—" : `${health.temp_c}°C`}
          detail={health.temp_c === null ? "no readable sensor" : "hottest zone"}
        />
        <Metric
          label="GPU"
          value={health.gpu?.util_pct === null || health.gpu?.util_pct === undefined ? "—" : `${health.gpu.util_pct}%`}
          detail={health.gpu ? health.gpu.name : "no GPU node"}
          percent={health.gpu?.util_pct ?? null}
        />
      </div>

      <h2 className="md-section-title" style={{ fontSize: "1.1rem", marginTop: "34px" }}>
        Host
      </h2>
      <dl className="md-kv">
        <dt>Hostname</dt>
        <dd>{info?.hostname ?? "—"}</dd>
        <dt>Platform</dt>
        <dd>{info?.platform ?? "—"}</dd>
        <dt>Python</dt>
        <dd>{info?.python ?? "—"}</dd>
        <dt>Desk root</dt>
        <dd>{info?.desk_root ?? "—"}</dd>
      </dl>
    </>
  );
}
