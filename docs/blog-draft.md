Lapel: Building a Job-Hunting Pipeline that Remembers You

Another season, another layoff.  It’s par for the course in the tech industry these days.  As I find myself in-between jobs, entering the senior experience bracket of my industry, it’s easy to be filled with dread at the prospect of selling myself on the free market.  It’s a full-time job in itself: I need to watch job boards, tailor my application to dodge Applicant Tracking System (ATS) filters, compile and remember meaningful work experiences from past jobs (including the ones who laid me off!), prepare for interviews, and make sure my portfolio contains worthwhile personal projects to feature.  Checkmate, anxiety.

But I’m an engineer, and what we do is examine problems, make a plan, and solve them.  So here’s what I came up with.  I leveraged agentic code development to create a tool that leverages AI to help with job hunting.  Not a new idea: it seems like ChatGPT or Claude is required nowadays to tailor resumes and get through ATS filters.  But I know I can make this more efficient.  So what I built was not just a job-hunting agent, a resume-tailoring agent, etc.  I combined all of the features I needed into a pipeline that efficiently stores necessary context across the tools, and continually builds a personal profile as you use it.

The tool is called lapel, because it “tailors” your application (hey, you work with AI, you get AI names 😜.  I don’t think it’s too bad though!).  It’s a local command-line app that creates a personal profile and uses it to score job postings for fit, draft tailored application materials, and coach you for interviews.  I’m going to dedicate the rest of this post to detailing the engineering story of how I leveraged agentic coding to build the tool, what I learned about using agents to code and coding products with agents in them, and how useful the product ended up being in the end.  If you’re interested, the tool is open-source and lives here: https://github.com/ciwaskiw/lapel

My goals going into this venture:

1. Create a portfolio piece (the tool and this post) that I can leverage in applications and interviews that demonstrates my design sense and agentic coding skills.
2. Create a tool I will actually use in my job hunt to make the process less anxiety-inducing and unbearable (and more efficient with AI token usage: I’m not spending a company’s subscription money anymore!)
3. Hopefully make a tool somebody else might find useful!
So let’s get started detailing the process.  The first thing I looked at is agentic code development.

During my last year at my previous company I became very familiar with agentic code development.  The idea is that with the advanced LLMs at our disposal faster than we could ever be at menial coding tasks, our roles as engineers shift from programmer to designer.  It’s similar to the shift from a junior to a senior contributor: as we grow in our dev careers, we write less code and do more architecture design, ticket writing, and resource management.  This seems to be where the industry is heading.  It’s a little scary regarding the plight of the entry-level engineer entering the industry right now, but that’s a topic for another post.

Something I already knew I wanted to use was the superpowers[https://github.com/obra/superpowers] plugin for Claude Code.  This awesome suite of Claude skills gives your agent a software development methodology, and without it the project would have probably taken longer, cost more tokens, and been sloppier and messier.  Before I get too much into the weeds, let’s just walk through how I built this.

## Getting Started

I started with a fresh Claude Code Opus chat window and made sure to start with `/using-superpowers`.  This skill makes sure that the session will use the SWE methodology and the other superpowers skills.  Then I explained what I wanted the tool to do - at this point, what I wanted was:

1. Create a profile based on input documents (resume, linkedin profile) and an AI interview
2. Score job descriptions for fit from that profile
3. Tailor a resume and cover letter for each job description
4. Pipeline-ify this by passing the scored JDs to the tailor step.

So the first thing that the chat did was use the `/brainstorming` superpowers skill.  After some back-and-forth we came to even more ideas.  For example:

1. We can use sqlite to store JDs and scores across sessions
2. We can include a short "gap interview" during the tailor step to both make the tailored application more accurate but also attach to the profile, making it learn you as you use the tool more and more.
3. We can include a pre-filter step when posting a big company's job board so the AI doesn't have to crawl through all of the JDs and use up tokens reading irrelevant descriptions.
4. We can include commands for changing Claude agents - in case you want to save tokens with Sonnet or power through with Opus

With a suite of ideas ready and one final chat with Opus regarding the features we wanted, we moved on to the spec step.

## Product Specification and Writing Plans

The way that the superpowers plugin works here is that it first writes a product specification (or "spec")

find pulls open roles from public ATS APIs (Greenhouse, Lever, Ashby), runs a cheap deterministic filter, then scores the survivors for fit and drops them into a local pipeline with a real status funnel (new → interested → applied → interviewing).
tailor writes a role-specific résumé summary, cover letter, and a private "fit notes" doc — grounded strictly in my profile, no fabrication.
prep is a live, multi-turn interview-coaching chat for a specific job that picks up where I left off.
The part that makes it more than prompting in a window: it builds and remembers a profile of me, and it keeps that context on disk instead of in an ever-growing chat history. [your voice — if you want, one honest line about whether others would find it useful vs. it being scratch-your-own-itch]

⤷ insert the architecture diagram here (deterministic core → LLM layer → CLI + MCP front-ends).

The method: spec, then plan, then agents
The thing I most wanted to get right wasn't the code — it was the process. I used the superpowers plugin's workflow [your voice — confirm the link/name you want to credit], which pushes you through three stages before and during a build:

Brainstorm into a committed spec. Before any code, I talked through requirements and architecture with the model and we wrote it down as a design doc in the repo.
Decompose into sequenced, test-driven plans. Each plan is a list of bite-sized tasks with the actual tests and code spelled out.
Execute with subagents. A fresh agent implements each task in isolation; I review between tasks.
The reason this matters — and the reason I'll keep coming back to it — is that the intent lives in committed files, not in a chat window. The spec and plans are on disk, in git, reviewable.

The clearest way to show the method is the interview coach, prep, which I added late. Its spec goals read like a design brief I'd be happy to hand a coworker:

a live, multi-turn coaching chat, not a one-shot brief (the back-and-forth is the point);
the interview's nature — round type, interviewer, format — established conversationally at the start, instead of some rigid --type flag;
grounded in the profile + the full posting only (the same "no fabrication" contract as tailor);
resume-with-memory: re-running prep <job-id> continues where I left off;
a saved study-sheet recap to skim before the call.
Spec → plan → built, [your voice — a sentence on how it felt to use prep / whether it actually helped you in a real interview, if applicable]. [link the spec + plan files]

Watching the meter
[your voice — a sentence of personal framing: you were cost-conscious because ___ (between jobs / on a Pro plan / just principled about waste)]

Once I started paying attention, I realized the same discipline — don't drag context you don't need — applies in two places at once.

In how I built it. I leaned on model tiering: a stronger model (Opus) for planning and review, a cheaper one (Sonnet) for the mechanical implementation. Subagents kept the orchestrating session lean, because each one started cold with exactly the task text it needed and nothing else. And critically, the plans-and-specs-on-disk habit meant I never had to keep one giant chat alive to "remember" the project — the project remembered itself.

In the product itself. lapel mirrors the same instinct at runtime: a fast model does scoring and most tailoring while a stronger tier is reserved for synthesis; a deterministic prefilter does cheap keyword/title work before any LLM call is made; and every prompt is assembled from the structured profile rather than a growing transcript. It can run against the Anthropic API or — the part I'm happiest about — against my Claude subscription via the Claude Code CLI, so day-to-day use doesn't run up an API bill.

⤷ optional: a concrete number here would land hard — e.g. "scoring the whole watchlist costs roughly N calls" or a before/after token figure. Drop one in if you have it.

The real payoff came after the "build" was done
Here's the part I didn't expect, and the part I'd most want another engineer to take away.

When the initial three plans were done, lapel "worked" — but it wasn't done. I started using it on my own real job leads, and immediately found things to fix and features I wanted: a way to forget a company, a way to score jobs I'd only scouted, the whole interview coach, a serious rework of the scoring filter. [your voice — which of these annoyed you most in practice?]

And every one of those was cheap to do, because of the workflow, not in spite of it. I could come back days later, in a fresh session, point the agent at the repo's CLAUDE.md and the relevant plan, and it had everything it needed — no re-explaining the architecture, no scrolling back through a bloated conversation to reconstruct a decision. The context I needed was already written down. Adding prep was its own little spec-and-plan; fixing a bug was a five-minute focused session. The thing that's usually painful about coming back to a project — reloading all the context into your (or the model's) head — mostly went away.

I want to be honest about authorship here, because it's the actually-interesting bit: a lot of the design was the agents', not mine. The module boundaries, the decision to drop a dependency that turned out to be unused and was breaking npm install — those happened during execution, with me steering and reviewing rather than hand-architecting every call. My value was in the directing, the reviewing, and catching the moments where reality pushed back (next section). That's a different skill than "writing all the code," and it's the one this whole exercise was really about.

[your voice — your honest take on how that felt: empowering? uncomfortable? where did you most need to override the agent?]

⤷ There's one lucky break worth being candid about: I'd assumed a Pro plan wouldn't let me run this at all, and it was partly luck that routing through the Claude Code CLI worked with no API key. The structure made adopting it a small change — but I didn't plan for it, I got rescued by it. [keep/cut this honesty depending on how you feel — I think it's a strength.]

Where reality pushed back
The build → use → learn → fix loop is the actual story, so here are the moments the tool met real data and lost:

An adapter that was just wrong. My Ashby integration used a POST request; the live API only answers GET. I never caught it from tests — I caught it the first time I pointed lapel at a real company on Ashby and got a 401. [your voice — small "of course it was the simplest possible bug" aside]
The classic hang. A command did all its work, printed its result… and never exited. An interactive prompt left a readline handle open, keeping the process alive. Five-minute fix, very humbling.
A filter that was "too dumb and too strict." This is my favorite. The first version of the scoring prefilter matched fuzzy preferences — "Agile development," "Testing culture," "no relocation" — as literal keywords against the full job description, and used them as hard pass/fail gates. The result: it dropped every single job, and it flagged a perfectly good remote role because the posting's boilerplate said it offered no relocation assistance.
That last one forced a principle I'll keep: don't make a deterministic layer adjudicate fuzzy things. I rewrote the prefilter to gate only on signals it can read reliably — the job title, the seniority, the structured remote flag — and moved all the fuzzy judgment (skills, culture, "does this really require relocating?") to the LLM scorer, which can weigh them in context. The dumb layer does dumb, reliable work; the smart layer does smart work; nobody pretends to be the other.

[your voice — if you have a screenshot of the "dropped 43 jobs" output, it's a great visual here.]

What I'd tell you to take from it
Move recurring AI help out of the chat and into a pipeline with persistent, structured memory. The win isn't a smarter model; it's not making the model re-derive your context every time.
The context window is the bottleneck — in the product and in the build. Externalize the durable stuff (a spec, a plan, a profile) and assemble a tight prompt for each task.
Specs and plans on disk are what make agentic coding sustainable. They're how a fresh, cheap session picks up exactly where you left off — that's where the real leverage was for me.
Match the model to the task. Heavy orchestration earned its cost for the big from-scratch build; for a small feature, a single cheap session doing TDD was just as good and a fraction of the price. [your voice — your own rule of thumb]
Guardrails are what let you trust cheaper agents. A test suite and a couple of enforced boundaries caught the things a fast model would otherwise have missed.
lapel is still a work in progress — [list 2-3 backlog items]. But it's real, it's [N] tests deep, and I'm running my own search through it right now: finding roles, tailoring applications, and prepping for the interviews. [your voice — closing line; the "maybe the job I land came through it" note if you like it]

[Try it: link to the repo, one-line setup.]

That's ~80% drafted. Open questions for your pass:

The superpowers credit — confirm exactly how you want to name/link it (and whether to name the specific skills: brainstorming, writing-plans, subagent-driven-development).
The authorship honesty in §"real payoff" and the Pro "luck" sidenote — I leaned into candor because it makes the piece stronger and more trustworthy, but it's your reputation; trim if it feels like too much.
Want me to save this as docs/blog-draft.md (or keep it out of the public repo since it's personal writing), and/or tighten any section once you've dropped your voice in?
