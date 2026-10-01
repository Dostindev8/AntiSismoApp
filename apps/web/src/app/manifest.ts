import type { MetadataRoute } from "next";

import tokens from "@antisismo/config/tokens.json";
import messages from "@antisismo/config/web-messages/es-DO.json";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: messages.meta.title,
    short_name: messages.brand.name,
    description: messages.meta.description,
    lang: "es-DO",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: tokens.colors.bgDeep,
    theme_color: tokens.colors.bgDeep,
    icons: [
      { src: "/brand/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/brand/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/brand/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
