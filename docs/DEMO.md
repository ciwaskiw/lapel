# Demo

An illustrative end-to-end session showing the workflow and the shape of the output. (Numbers and
company names are representative, not a specific real run — swap in a captured transcript of your own
once you've built a profile.)

```text
$ node dist/cli.js profile build
# parses the PDFs in ./profile/, then a short interview:

What roles are you targeting (titles / seniority)?
> Senior / Staff full-stack engineer

What are your location and remote preferences? Any max commute?
> Remote (US), or hybrid within 30 miles of Boston

Anything your résumé under-sells that we should capture?
> Heavy event-driven / serverless AWS work that reads as "backend" but is full-stack

Profile saved to profile/profile.json and profile/profile.md.

$ node dist/cli.js find
Prefilter dropped 18 job(s)  (see stderr for reasons)
Fetched 142, added 37, updated 5, dropped 18.

ID  Score  Status  Title                       Company    Location
12  91     new     Senior Full-stack Engineer  Acme       Remote - US
7   84     new     Staff Software Engineer     Globex     Boston, MA
…

$ node dist/cli.js status 12 interested
Job 12 → interested

$ node dist/cli.js tailor 12
This role leans heavily on event-driven systems; your profile mentions it briefly.
> Tell me about your event-driven work — scale, your role, what you built.
> Designed an EventBridge + Lambda fan-out processing ~5M events/day; owned it end to end.

Update your profile? You described event-driven experience: "Designed an EventBridge…" (y/N) y

Tailored docs written to output/acme-senior-full-stack-engineer
  ├── resume-summary.md
  ├── cover-letter.md
  └── fit-notes.md

$ node dist/cli.js pipeline --status interested
ID  Score  Status       Title                       Company  Location
12  91     interested   Senior Full-stack Engineer  Acme     Remote - US
```
