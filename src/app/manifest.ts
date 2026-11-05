import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Mini FOKUS Dispatch",
    short_name: "FOKUS Dispatch",
    start_url: "/",
    display: "standalone",
    background_color: "#f3f4f6",
    theme_color: "#047857",
    lang: "id",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
