import express from "express";
import fetch from "node-fetch";

const router = express.Router();

const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL || "https://beenest.in";
const DEFAULT_IMAGE = `${FRONTEND_BASE_URL}/logo512.png`;

const escapeHtml = (value = "") =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const stripHtml = (value = "") => String(value).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

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

    const title = article?.name
      ? `${article.name} | Beenest Magazine`
      : "Beenest Magazine | India's Leading Art, Design & Culture Platform";

    const description =
      article?.subTitle ||
      stripHtml(article?.description?.text || article?.description?.html || "").slice(0, 180) ||
      "Discover Beenest Magazine - India's contemporary art, design, and culture platform.";

    const image = article?.featuredImage?.url || DEFAULT_IMAGE;

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
    <meta property="og:image:secure_url" content="${escapeHtml(image)}" />
    <meta property="og:image:alt" content="${escapeHtml(title)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(image)}" />
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
