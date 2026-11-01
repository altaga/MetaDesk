/** The MetaDesk mark plus wordmark, shared by the landing, login and desk. */
export function BrandMark({ label = "MetaDesk" }: { label?: string }) {
  return (
    <span className="md-brand">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/metadesk-mark.svg" alt="" width={30} height={30} />
      <span>{label}</span>
    </span>
  );
}
