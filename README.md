# agents-outreach-team workshop site

The student guide and instructor console for the **agents-outreach-team** workshop.
Live at https://agents-outreach-team.vercel.app (the older
outreach-workshop-site.vercel.app points at the same project).

Students are given **no zip**. They sign in with a name and email, read a short
overview of what they're building, then create an empty folder, open it in the
Claude desktop app, and build the project by pasting one prompt per file into
Claude. The page is the distribution mechanism.

The workshop deliberately uses **no skills**, because students have not been
taught them yet. The manager's procedure is a prompt students paste each run: the
**run prompt** (Rounds 1 to 3, with company and role filled in by the page) and the
**batch prompt** (Round 4).

```
index.html          the student guide: sign-in, 12 steps, 9 file prompts, the run and
                    batch prompts, feedback form on the finish screen
instructor.html     the instructor console, served at /instructor (needs the key)
api/progress.js     POST only: a student saves their own progress
api/feedback.js     POST only: a student rates the workshop
api/instructor.js   GET only, key required: every student, email, and piece of feedback
lib/store.js        shared validation and storage (outside api/, so it isn't a route)
vercel.json         cleanUrls, so /instructor works without .html
```

`../outreach-team/` holds the canonical copy of every prompt on the page. It is the
source of truth, not the thing students receive. After editing any file there,
re-run the verification below.

```
CLAUDE.md, .claude/, me/, targets.md    files students create, verbatim
extras/recruiter.md                     created by students in Round 3, at .claude/agents/
prompts/run-pipeline.md                 the run prompt; {{TARGET}} is filled in by the page
prompts/run-batch.md                    the batch prompt
extras/skills/                          the original /outreach skills, unused; kept for a
                                        later session on skills
README.md                               stale: describes the old zip + slash-command version
```

## Verifying the embedded prompts

Each `<script type="text/plain" data-verify="...">` block in `index.html` carries a
`data-verify` path into `../outreach-team/`. This diffs every embedded copy against
its canonical original and exits non-zero on any drift:

```bash
node -e '
const fs=require("fs"), SRC="../outreach-team/";
const html=fs.readFileSync("index.html","utf8");
let m,fail=0,re=/<script type="text\/plain"([^>]*)>([\s\S]*?)<\/script>/g;
while((m=re.exec(html))){
  const v=/data-verify="([^"]*)"/.exec(m[1]); if(!v) continue;
  const body=m[2].replace(/^\n/,"").replace(/\s+$/,"")+"\n";
  const ok=body===fs.readFileSync(SRC+v[1],"utf8");
  console.log((ok?"  OK    ":"  DIFF  ")+v[1]); if(!ok) fail++;
}
process.exit(fail?1:0);'
```

## Deploy

```bash
vercel --prod
```

The project needs two things set up once, both already done:

- **A Redis store.** `vercel integration add upstash` added `KV_REST_API_URL` and
  `KV_REST_API_TOKEN`. `Redis.fromEnv()` reads those, or `UPSTASH_REDIS_REST_URL`
  and `UPSTASH_REDIS_REST_TOKEN` if you ever connect Upstash by hand.
- **`INSTRUCTOR_KEY`**, set for Production. Without it the console refuses every
  request rather than opening up.

## Instructor console

Open https://agents-outreach-team.vercel.app/instructor and enter the key. It stays
in that browser until you press **Lock**. Nothing on the student page links to it.

It shows, live every 5 seconds: headline numbers, how many students finished each
step and who is on it now, who is running long on their current step, median time
per step against the plan, the rating spread, every comment, and a filterable
student table with emails. **Export CSV** downloads the room.

To change the key:

```bash
vercel env rm INSTRUCTOR_KEY production
vercel env add INSTRUCTOR_KEY production
vercel --prod
```

## Rooms

Progress is namespaced by room, so one URL serves more than one cohort:

```
https://agents-outreach-team.vercel.app/?room=gsb-fall
https://agents-outreach-team.vercel.app/instructor?room=gsb-fall
```

No `room` parameter means the room called `default`. The console lists every room
that has data. Each room expires 30 days after its last write.

## Privacy

Students give a name and email at sign-in. Both are stored in Redis with their
progress and any feedback, keyed by email, and deleted automatically 30 days after
the room's last activity. Only `/api/instructor` returns them, and only with the
key. The write endpoints accept a student's own record and never echo anyone
else's.

## Without a database

The student page still works with no store connected: progress persists in each
browser via `localStorage`, and feedback shows a "didn't send" message. Nothing
else errors.

## Limits

Deliberate caps in `lib/store.js`, all adjustable:

| Cap | Value |
|---|---|
| Students per room | 300 |
| Name length | 60 characters |
| Email length | 120 characters |
| Feedback comment | 2,000 characters |
| Room data kept | 30 days after last write |

## Deploying

Pushing to `main` deploys to production. The Vercel project is connected to
this repository, so no local CLI is involved and no one's laptop has to be
awake. Work on a branch when a change is not ready to be live: a branch push
gets a preview URL instead.

Environment variables live in Vercel, not here. `INSTRUCTOR_KEY` gates
`/instructor`, and the Upstash Redis credentials arrive through the
Marketplace integration.
