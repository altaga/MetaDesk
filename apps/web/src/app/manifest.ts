import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MetaDesk",
    short_name: "MetaDesk",
    description:
      "MetaDesk is an operator desk whose brain lives on your own board, powered by the Meta Muse model ladder.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#0b0c0e",
    theme_color: "#0b0c0e",
    categories: ["productivity", "utilities"],
    lang: "en",
    icons: [
      {
        src: "/pwa-icon-192",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/pwa-icon-512",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    screenshots: [
      {
        src: "/pwa-icon-512",
        sizes: "512x512",
        type: "image/png",
        form_factor: "wide",
        label: "MetaDesk icon",
      },
    ],
  };
}
