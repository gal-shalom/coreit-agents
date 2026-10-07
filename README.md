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

## blog-writer-agent.ts

Writes one SEO blog post with Claude and publishes it to
`coreit.hashnode.dev` via the Hashnode API. Runs weekly via GitHub Actions
(`.github/workflows/blog.yml`, Mondays 14:00 UTC) and can be triggered by
hand from the **Actions** tab (`workflow_dispatch`).

Run locally:
```bash
ANTHROPIC_API_KEY=... HASHNODE_API_KEY=... npm run blog
```

### Env vars required
- `ANTHROPIC_API_KEY` — writes the post via the Claude Messages API
- `HASHNODE_API_KEY` — publishes to the Hashnode publication

For the scheduled run, add both as repository secrets
(**Settings → Secrets and variables → Actions**). The Hashnode publication at
`coreit.hashnode.dev` must already exist, or the run exits with
"Could not get publication ID".

### Topic rotation
Topics come from the `TOPICS` array and rotate deterministically by week, so a
topic doesn't repeat until the whole list has cycled. Add new topics to that
array to keep the blog fresh.
