import { ImageResponse } from "next/og";
import { IconArtwork } from "@/features/pwa/IconArtwork";

export async function GET() {
  return new ImageResponse(<IconArtwork size={180} label="" />, {
    width: 180,
    height: 180,
  });
}
