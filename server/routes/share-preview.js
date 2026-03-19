import express from "express";
import fetch from "node-fetch";

const router = express.Router();

const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL || "https://beenest.in";
const DEFAULT_IMAGE = `${FRONTEND_BASE_URL}/og-default.png`;

const escapeHtml = (value = "") =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const stripHtml = (value = "") => String(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const clampText = (value = "", maxLength = 60) => {
  const text = String(value || "").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
};

const buildSeoTitle = (rawTitle) => {
  const suffix = " | Beenest";
  if (!rawTitle) return "Beenest Magazine | Art, Design & Culture in India";
  const titleText = String(rawTitle).trim();
  if (`${titleText}${suffix}`.length <= 60) return `${titleText}${suffix}`;
  return clampText(titleText, 60);
};

const withOgImageRatio = (rawImage) => {
  const image = String(rawImage || "").trim();
  if (!image) return DEFAULT_IMAGE;
  if (!/graphassets\.com/i.test(image)) return DEFAULT_IMAGE;
  const separator = image.includes("?") ? "&" : "?";
  return `${image}${separator}width=1200&height=630&fit=crop&fm=jpg&q=80`;
};

router.get("/article/:slug", async (req, res) => {
  const slug = req.params.slug;
  const articleUrl = `${FRONTEND_BASE_URL}/article/${encodeURIComponent(slug)}`;

  try {
    const query = `
      query ShareArticle($slug: String!) {
        magazine(where: { slug: $slug }) {
          name
          subTitle
          description {
            html
            text
          }
          featuredImage {
            url
          }
        }
      }
    `;

    const hygraphRes = await fetch(process.env.HYGRAPH_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.HYGRAPH_TOKEN}`,
      },
      body: JSON.stringify({ query, variables: { slug } }),
    });

    const payload = await hygraphRes.json();
    const article = payload?.data?.magazine;

    const title = buildSeoTitle(article?.name);

    const description =
      article?.subTitle ||
      stripHtml(article?.description?.text || article?.description?.html || "").slice(0, 180) ||
      "Discover Beenest Magazine - India's contemporary art, design, and culture platform.";

    const image = withOgImageRatio(article?.featuredImage?.url || DEFAULT_IMAGE);

    return res.status(200).send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${escapeHtml(articleUrl)}" />
    <meta property="og:site_name" content="Beenest Magazine" />
    <meta property="og:type" content="article" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(articleUrl)}" />
    <meta property="og:image" content="${escapeHtml(image)}" />
    <meta property="og:image:url" content="${escapeHtml(image)}" />
    <meta property="og:image:secure_url" content="${escapeHtml(image)}" />
    <meta property="og:image:type" content="image/jpeg" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${escapeHtml(title)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(image)}" />
    <meta name="twitter:image:src" content="${escapeHtml(image)}" />
    <meta name="twitter:image:alt" content="${escapeHtml(title)}" />
    <meta name="twitter:image:width" content="1200" />
    <meta name="twitter:image:height" content="630" />
    <meta http-equiv="refresh" content="0;url=${escapeHtml(articleUrl)}" />
    <script>window.location.replace(${JSON.stringify(articleUrl)});</script>
  </head>
  <body>
    <p>Redirecting to <a href="${escapeHtml(articleUrl)}">article</a>...</p>
  </body>
</html>`);
  } catch (error) {
    return res.redirect(articleUrl);
  }
});

export default router;
