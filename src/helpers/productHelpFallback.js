import topics from "../config/productHelpTopics.json" with { type: "json" };

export const DOCS_ORIGIN = "https://github.com/valoche-68/whisprlocal#readme";

export function bundledHelp(topic, reason) {
  const article = topics[topic];
  return {
    source: "bundled",
    reason,
    retrievedAt: null,
    articles: [
      { title: topic, url: DOCS_ORIGIN + article.path, path: article.path, text: article.text },
    ],
  };
}
