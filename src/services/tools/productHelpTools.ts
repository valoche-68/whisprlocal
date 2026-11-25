import type { ToolDefinition, ToolResult } from "./ToolRegistry";
import {
  HELP_TOPICS,
  lookupHelp,
  getHelpContext,
  type HelpTopic,
  type HelpResult,
} from "../help/productHelp";
import i18n from "../../i18n";
import { bundledHelp, DOCS_ORIGIN } from "../../helpers/productHelpFallback";
import topics from "../../config/productHelpTopics.json";

const topicSchema = {
  type: "string",
  enum: HELP_TOPICS,
  description: "The WhisprLocal product topic. No user content is sent to documentation search.",
};
const instruction = `Answer in the user's language. Use the bundled WhisprLocal guide and read the relevant current settings when needed. Keep current settings separate from general guidance, and read the current settings again on each help turn. For activationMode, push means Hold and tap means Tap. For documentation, use ${DOCS_ORIGIN}.`;

// Keep tool output small; these are explicitly partial references, not complete articles.
// Pages take the shared budget in order, so the topic's main page isn't cut before its
// instructions; a page left without budget keeps its link as an empty excerpt.
function modelHelp(result: HelpResult): HelpResult {
  let remaining = 4000;
  return {
    ...result,
    articles: result.articles.map((article) => {
      const text = article.text.slice(0, remaining);
      remaining -= text.length;
      return {
        ...article,
        title: article.title.slice(0, 160),
        text,
        untrusted: result.source === "live",
        excerpt: article.text.length > text.length,
      };
    }),
  };
}

export const productHelpTools: ToolDefinition[] = [
  {
    name: "search_openwhispr_help",
    description:
      "Find the bundled WhisprLocal guide for a product topic.",
    parameters: {
      type: "object",
      properties: { topic: topicSchema },
      required: ["topic"],
      additionalProperties: false,
    },
    readOnly: true,
    promptInstruction: instruction,
    async execute(args, context): Promise<ToolResult> {
      if (!HELP_TOPICS.includes(args.topic as HelpTopic)) throw new Error("Invalid help topic");
      const data =
        context && !context.claimTurnSlot("product-help-lookups", 3)
          ? (bundledHelp(args.topic as HelpTopic, "rateLimit") as HelpResult)
          : await lookupHelp(
              args.topic as HelpTopic,
              context?.signal ?? new AbortController().signal
            );
      return {
        success: true,
        data: modelHelp(data),
        displayText: i18n.t(`productHelp.sourceStatus.${data.source}`),
      };
    },
  },
  {
    name: "read_openwhispr_help",
    description:
      "Read local WhisprLocal help for a product topic.",
    parameters: {
      type: "object",
      properties: {
        topic: topicSchema,
        page: {
          type: "string",
          enum: [...new Set(Object.values(topics).flatMap((entry) => entry.paths))],
          description:
            "Exact returned path beginning with /; never a URL, filename or shell command.",
        },
      },
      required: ["topic", "page"],
      additionalProperties: false,
    },
    readOnly: true,
    async execute(args, context): Promise<ToolResult> {
      if (!HELP_TOPICS.includes(args.topic as HelpTopic)) throw new Error("Invalid help topic");
      const topic = args.topic as HelpTopic;
      const valid = typeof args.page === "string" && topics[topic].paths.includes(args.page);
      // Bounded recovery: never repair/execute the supplied path. One ordinary
      // fixed-topic lookup provides usable evidence and terminates this call.
      const canRecover =
        (valid || context?.claimTurnSlot("help-invalid-page-recovery", 1) === true) &&
        (!context || context.claimTurnSlot("product-help-lookups", 3));
      const data: HelpResult = canRecover
        ? await lookupHelp(
            topic,
            context?.signal ?? new AbortController().signal,
            valid ? (args.page as string) : undefined
          )
        : (bundledHelp(topic, "rateLimit") as HelpResult);
      return {
        success: true,
        data: valid
          ? modelHelp(data)
          : {
              ...modelHelp(data),
              recovery: "invalid-page-used-topic-essentials",
              instruction:
                "The page was not an allowed path for this topic. Use these essentials; do not retry. Future reads must copy an exact returned path, including its leading slash and without .mdx.",
            },
        displayText: i18n.t(`productHelp.sourceStatus.${data.source}`),
      };
    },
  },
  {
    name: "get_openwhispr_context",
    description:
      "Read the current WhisprLocal settings relevant to a product topic. Cannot change settings or read notes, credentials, private endpoints or file paths.",
    parameters: {
      type: "object",
      properties: { topic: topicSchema },
      required: ["topic"],
      additionalProperties: false,
    },
    readOnly: true,
    async execute(args): Promise<ToolResult> {
      if (!HELP_TOPICS.includes(args.topic as HelpTopic)) throw new Error("Invalid help topic");
      return {
        success: true,
        data: await getHelpContext(args.topic as HelpTopic),
        displayText: i18n.t("productHelp.settings"),
      };
    },
  },
];
