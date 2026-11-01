type Props = {
  size: number;
  /** Kept for the icon routes; the mark carries the brand on its own. */
  label?: string;
};

/**
 * The MetaDesk mark as a full-bleed tile. The OS applies its own corner mask to
 * app icons, so the tile is square and the mark stays inside the safe zone.
 */
export function IconArtwork({ size }: Props) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#0866ff",
      }}
    >
      <svg width={size} height={size} viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path
          d="M136 332 V180 L256 300 L376 180 V332"
          stroke="#ffffff"
          strokeWidth="52"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M136 396 H376" stroke="#ffffff" strokeOpacity="0.5" strokeWidth="22" strokeLinecap="round" />
        <path d="M404 92 L416 126 L450 138 L416 150 L404 184 L392 150 L358 138 L392 126 Z" fill="#ffffff" />
      </svg>
    </div>
  );
}
