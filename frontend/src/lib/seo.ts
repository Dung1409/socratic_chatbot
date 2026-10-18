import { APP_TITLE } from "@/lib/brand";

export const seo = (title: string, description: string) => ({
  meta: [
    { title: `${title} · ${APP_TITLE}` },
    { name: "description", content: description },
    { property: "og:title", content: `${title} · ${APP_TITLE}` },
    { property: "og:description", content: description },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ],
});
