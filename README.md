# CoreIT Agents

Autonomous lead gen & outreach agents for CoreIT.

## lead-gen-agent.ts

Runs weekly. For each target domain:
1. Queries Hunter.io for CIO/CTO/IT Director emails
2. Skips already-contacted leads (tracked in contacted.json)
3. Sends Email #1 via Resend immediately
4. Schedules Email #2 (day 3) and Email #3 (day 10)

### Env vars required
- `RESEND_API_KEY`

### Add new target domains
Edit the `TARGET_DOMAINS` array in `lead-gen-agent.ts`.

## Blog (coreit.hashnode.dev)

The weekly blog is split into **write** and **publish** so it can run on a
Claude subscription with no LLM API key.

### Active flow: scheduled Claude Code task (auto-publish)

A weekly scheduled Claude Code task writes the post (on the Claude
subscription — no metered API key) and then runs the publish-only script
below to post it. The only secret required is `HASHNODE_API_KEY`, stored as
an **environment secret** in the Claude Code environment.

### publish-to-hashnode.ts

Publishes a pre-written post to `coreit.hashnode.dev`. Needs only
`HASHNODE_API_KEY` — no LLM key. Takes a JSON file:

```json
{ "title": "...", "subtitle": "...", "tags": ["a","b"], "content": "# markdown" }
```

```bash
HASHNODE_API_KEY=... npm run publish -- post.json
```

It skips a post whose exact title is already published, and exits non-zero on
failure. The publication at `coreit.hashnode.dev` must already exist, or it
exits with "Could not get publication ID".

### blog-writer-agent.ts (optional, needs an LLM API key)

A fully self-contained alternative that writes *and* publishes in one shot
using the Claude Messages API — use it only if you have an
`ANTHROPIC_API_KEY`. Topics live in its `TOPICS` array and rotate
deterministically by week.

```bash
ANTHROPIC_API_KEY=... HASHNODE_API_KEY=... npm run blog
```
