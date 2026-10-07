#!/usr/bin/env npx ts-node
/**
 * CoreIT Blog Writer Agent
 * - Picks a fresh SEO topic relevant to IT managers at SMBs
 * - Writes a full blog post using Claude
 * - Publishes to coreit.hashnode.dev via Hashnode API
 */

import https from "https";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const HASHNODE_API_KEY = process.env.HASHNODE_API_KEY;
const HASHNODE_HOST = "coreit.hashnode.dev";

// Fail fast with a clear message instead of sending `undefined` as a credential
// and getting an opaque 401 three calls later.
const missing = [
  !ANTHROPIC_API_KEY && "ANTHROPIC_API_KEY",
  !HASHNODE_API_KEY && "HASHNODE_API_KEY",
].filter(Boolean);
if (missing.length) {
  console.error(`Missing required env var(s): ${missing.join(", ")}`);
  process.exit(1);
}

const TOPICS = [
  "How to audit your SaaS subscriptions in one afternoon",
  "The hidden cost of slow IT onboarding at growing companies",
  "Why employee offboarding is your biggest security risk",
  "5 signs your IT asset tracking is broken (and how to fix it)",
  "License sprawl: how SMBs waste thousands on software nobody uses",
  "The IT manager's checklist for onboarding a new hire in under an hour",
  "How to build an IT asset inventory from scratch",
  "Shadow IT at small companies: what it costs and how to stop it",
  "BYOD policies for SMBs: a practical guide",
  "How to reduce SaaS spend by 30% without cutting tools people love",
];

function request(method: string, hostname: string, urlPath: string, body?: any, headers: Record<string, string> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const req = https.request({
      method, hostname, path: urlPath,
      headers: { "Content-Type": "application/json", ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}), ...headers },
    }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
    });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function getPublicationId(): Promise<string> {
  const query = `{ publication(host: "${HASHNODE_HOST}") { id } }`;
  const result = await request("POST", "gql.hashnode.com", "/", { query }, {
    Authorization: HASHNODE_API_KEY,
  });
  return result?.data?.publication?.id;
}

async function writePost(topic: string): Promise<{ title: string; content: string; subtitle: string; tags: string[] }> {
  const result = await request("POST", "api.anthropic.com", "/v1/messages", {
    model: "claude-sonnet-4-6",
    // A 600-900 word markdown post, JSON-escaped and wrapped with title/subtitle/
    // tags, routinely exceeds 3000 output tokens — too low a cap truncates the
    // response mid-JSON and the parse below fails. 8000 leaves ample headroom.
    max_tokens: 8000,
    messages: [{
      role: "user",
      content: `Write an SEO-optimized blog post for CoreIT — a B2B SaaS IT management portal for IT managers at small and midsize companies (10-200 employees).

Topic: "${topic}"

Requirements:
- Tone: practical, peer-to-peer (IT manager talking to another IT manager), no fluff
- Length: 600-900 words
- Structure: intro hook, 3-5 actionable sections with H2 headers, conclusion with soft CTA to try CoreIT free
- Include 1 naturally placed mention of CoreIT as a solution (not pushy)
- SEO: use the topic keywords naturally throughout
- No bullet-point-heavy filler — write in paragraphs

Return a JSON object with these exact keys:
{
  "title": "the post title",
  "subtitle": "one sentence subtitle for SEO meta",
  "tags": ["tag1", "tag2", "tag3"],
  "content": "the full post in markdown"
}

Return ONLY valid JSON, nothing else.`,
    }],
  }, {
    "x-api-key": ANTHROPIC_API_KEY,
    "anthropic-version": "2023-06-01",
  });

  // Surface API failures instead of swallowing them. The old `?? "{}"` turned a
  // 401/404/429 (bad key, no model access, rate limit) into an empty object, so
  // the real error only showed up later as a confusing `undefined.toLowerCase()`.
  if (result?.type === "error") {
    throw new Error(`Anthropic API error: ${result.error?.type} — ${result.error?.message}`);
  }
  const text: string | undefined = result?.content?.[0]?.text;
  if (!text) {
    throw new Error(`Unexpected Anthropic response: ${JSON.stringify(result).slice(0, 500)}`);
  }
  if (result.stop_reason === "max_tokens") {
    throw new Error("Response hit max_tokens — JSON is truncated. Raise max_tokens or shorten the post.");
  }

  const post = parsePostJson(text);
  if (!post.title || !post.content) {
    throw new Error(`Model returned JSON without a title/content: ${text.slice(0, 300)}`);
  }
  // Normalize optional fields so publishPost never dereferences undefined.
  post.subtitle = post.subtitle || "";
  post.tags = Array.isArray(post.tags) ? post.tags : [];
  return post;
}

// Models often wrap "JSON only" output in ```json fences or add a stray
// sentence. Strip a fenced block if present, else fall back to the outermost
// {...} span, then parse.
function parsePostJson(text: string): { title: string; content: string; subtitle: string; tags: string[] } {
  let candidate = text.trim();
  const fence = candidate.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) {
    candidate = fence[1].trim();
  } else if (!candidate.startsWith("{")) {
    const first = candidate.indexOf("{");
    const last = candidate.lastIndexOf("}");
    if (first !== -1 && last > first) candidate = candidate.slice(first, last + 1);
  }
  try {
    return JSON.parse(candidate);
  } catch (err: any) {
    throw new Error(`Could not parse model output as JSON (${err.message}): ${candidate.slice(0, 300)}`);
  }
}

async function publishPost(publicationId: string, post: { title: string; content: string; subtitle: string; tags: string[] }) {
  const slug = post.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const mutation = `
    mutation PublishPost($input: PublishPostInput!) {
      publishPost(input: $input) {
        post { id url title }
      }
    }
  `;
  const variables = {
    input: {
      title: post.title,
      subtitle: post.subtitle,
      publicationId,
      contentMarkdown: post.content,
      slug,
      tags: post.tags.slice(0, 5).map((name: string) => ({ name, slug: name.toLowerCase().replace(/\s+/g, "-") })),
    },
  };

  return request("POST", "gql.hashnode.com", "/", { query: mutation, variables }, {
    Authorization: HASHNODE_API_KEY,
  });
}

async function getAlreadyPublished(): Promise<Set<string>> {
  const query = `{ publication(host: "${HASHNODE_HOST}") { posts(first: 20) { edges { node { title } } } } }`;
  const result = await request("POST", "gql.hashnode.com", "/", { query }, {
    Authorization: HASHNODE_API_KEY,
  });
  const posts = result?.data?.publication?.posts?.edges ?? [];
  return new Set(posts.map((e: any) => e.node.title));
}

async function main() {
  console.log(`\n🤖 CoreIT Blog Writer — ${new Date().toISOString()}`);

  const publicationId = await getPublicationId();
  if (!publicationId) { console.error("Could not get publication ID"); process.exit(1); }
  console.log(`Publication ID: ${publicationId}`);

  // Deterministic weekly rotation through the topic list. Stateless (works in a
  // cron CI run with no persisted file) and guarantees no repeat until the whole
  // list has cycled. The old approach filtered TOPICS by `!published.has(topic)`,
  // but `published` holds generated post *titles*, which never equal the raw
  // topic strings — so the filter did nothing and topics repeated at random.
  const weekIndex = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000)) % TOPICS.length;
  const topic = TOPICS[weekIndex];
  console.log(`Writing post: "${topic}"`);

  const post = await writePost(topic);
  console.log(`  Title: ${post.title}`);

  // Last-second guard against publishing the exact same title twice (e.g. the
  // job fires more than once in a week).
  const published = await getAlreadyPublished();
  if (published.has(post.title)) {
    console.log(`  Already published a post titled "${post.title}" — skipping.`);
    return;
  }

  const result = await publishPost(publicationId, post);
  const url = result?.data?.publishPost?.post?.url;

  if (url) {
    console.log(`  ✓ Published: ${url}`);
  } else {
    const detail = result?.errors ? JSON.stringify(result.errors) : JSON.stringify(result);
    console.error("  ✗ Publish failed:", detail);
    process.exit(1);
  }

  console.log("Done.\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
