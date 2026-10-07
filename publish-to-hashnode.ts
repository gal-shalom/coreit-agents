#!/usr/bin/env npx ts-node
/**
 * Publishes a pre-written post to coreit.hashnode.dev.
 *
 * Needs ONLY `HASHNODE_API_KEY` — no LLM API key. The post is written upstream
 * (by the weekly scheduled Claude Code task) and handed in as a JSON file:
 *
 *   { "title": "...", "subtitle": "...", "tags": ["a","b"], "content": "# markdown" }
 *
 * Usage: npx ts-node publish-to-hashnode.ts <post.json>
 */

import https from "https";
import { readFileSync } from "fs";

const HASHNODE_API_KEY = process.env.HASHNODE_API_KEY;
const HASHNODE_HOST = "coreit.hashnode.dev";

if (!HASHNODE_API_KEY) {
  console.error("Missing required env var: HASHNODE_API_KEY");
  process.exit(1);
}

type Post = { title: string; subtitle?: string; tags?: string[]; content: string };

function request(hostname: string, urlPath: string, body: any, headers: Record<string, string> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = https.request({
      method: "POST", hostname, path: urlPath,
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload), ...headers },
    }, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => { try { resolve(JSON.parse(data)); } catch { resolve(data); } });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function getPublicationId(): Promise<string | undefined> {
  const query = `{ publication(host: "${HASHNODE_HOST}") { id } }`;
  const result = await request("gql.hashnode.com", "/", { query }, { Authorization: HASHNODE_API_KEY! });
  if (result?.errors) throw new Error(`Hashnode error: ${JSON.stringify(result.errors)}`);
  return result?.data?.publication?.id;
}

async function getAlreadyPublished(): Promise<Set<string>> {
  const query = `{ publication(host: "${HASHNODE_HOST}") { posts(first: 20) { edges { node { title } } } } }`;
  const result = await request("gql.hashnode.com", "/", { query }, { Authorization: HASHNODE_API_KEY! });
  const posts = result?.data?.publication?.posts?.edges ?? [];
  return new Set(posts.map((e: any) => e.node.title));
}

async function publishPost(publicationId: string, post: Post) {
  const slug = post.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const mutation = `
    mutation PublishPost($input: PublishPostInput!) {
      publishPost(input: $input) { post { id url title } }
    }
  `;
  const variables = {
    input: {
      title: post.title,
      subtitle: post.subtitle,
      publicationId,
      contentMarkdown: post.content,
      slug,
      tags: (post.tags ?? []).slice(0, 5).map((name) => ({ name, slug: name.toLowerCase().replace(/\s+/g, "-") })),
    },
  };
  return request("gql.hashnode.com", "/", { query: mutation, variables }, { Authorization: HASHNODE_API_KEY! });
}

function loadPost(path: string): Post {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e: any) {
    console.error(`Cannot read post file "${path}": ${e.message}`);
    process.exit(1);
  }
  let post: Post;
  try {
    post = JSON.parse(raw);
  } catch (e: any) {
    console.error(`Post file is not valid JSON: ${e.message}`);
    process.exit(1);
  }
  if (!post.title || !post.content) {
    console.error('Post JSON must contain non-empty "title" and "content".');
    process.exit(1);
  }
  post.subtitle = post.subtitle || "";
  post.tags = Array.isArray(post.tags) ? post.tags : [];
  return post;
}

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: npx ts-node publish-to-hashnode.ts <post.json>");
    process.exit(1);
  }
  const post = loadPost(path);
  console.log(`Publishing: "${post.title}"`);

  const publicationId = await getPublicationId();
  if (!publicationId) {
    console.error(`Could not get publication ID. Does ${HASHNODE_HOST} exist, and does the token own it?`);
    process.exit(1);
  }

  const published = await getAlreadyPublished();
  if (published.has(post.title)) {
    console.log(`Already published a post titled "${post.title}" — skipping.`);
    return;
  }

  const result = await publishPost(publicationId, post);
  const url = result?.data?.publishPost?.post?.url;
  if (url) {
    console.log(`✓ Published: ${url}`);
  } else {
    const detail = result?.errors ? JSON.stringify(result.errors) : JSON.stringify(result);
    console.error("✗ Publish failed:", detail);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
