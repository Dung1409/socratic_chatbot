export const seo = (title: string, description: string) => ({
  meta: [
    { title: `${title} · SocraVăn` },
    { name: "description", content: description },
    { property: "og:title", content: `${title} · SocraVăn` },
    { property: "og:description", content: description },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ],
});
