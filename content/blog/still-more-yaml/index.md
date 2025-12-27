---
title: "Still More YAML"
date: 2025-12-26T00:00:00Z
lastmod: 2025-12-26T00:00:00Z
authors: ["Rishi Kulkarni"]
description: "Why software engineers spend 40% of their time on infrastructure instead of building things—and why the system makes this rational."
abstract: "Why do we spend so much time on meta-work in software engineering?"
tags: ["software engineering", "meta-work", "infrastructure", "devops", "career development", "engineering management"]
keywords: ["software engineering", "meta-work", "infrastructure", "devops", "Kubernetes", "YAML", "platform engineering", "resume-driven development", "career incentives"]
toc: false
---

My friend Alexa is a graphic designer. Last week I asked her what percentage of her time she spends on meta-design. She asked me what that meant.

"You know," I said, "the tooling. The workflow optimization. What's your asset pipeline look like? How do you orchestrate your color management?"

Alexa said she opens Illustrator, makes things, and exports them. Thinks about them later, revises, exports again. She has been using the same Wacom tablet for nine years. It still works. She has never once thought about her Wacom tablet.

I tried to explain that I, a software engineer—someone doing roughly analogous creative-technical work—spend approximately 30-40% of my time on the software equivalent of Wacom Tablet Configuration. Except we don't call it that. We call it "DevOps" or "infrastructure" or "platform engineering," and it has become so elaborate that there are people who do *only* this, full time, and they are in desperate shortage.

Alexa asked how long I had been doing this. I said since I left school. She looked confused and said that usually her students get over the "what brand of pencil should I use" phase in the first year or two.

<p style="text-align: center;">⁂</p>

Here is an incomplete list of things I have done in the past year that would be completely alien to Alexa:

- Migrated a build system from one "bash scripts written in YAML" framework to another "bash scripts written in YAML" framework, and then to Make because we should have just used Make in the first place
- Spent not-insignificant time wondering why enabling ECS Service Connect resulted in 503 errors during deployments
- Attended meetings about whether to use Kubernetes or ECS, committed to one, and then executed the migration, which had absolutely zero impact on the end user experience
- Reviewed a PR for a tool that generates code because the off-the-shelf code generator didn't quite do what we wanted
- Built a CI pipeline for a multi-repo architecture that convinced us to switch to a monorepo, which necessitated building a new CI pipeline

Here is what Alexa did this year: she designed things. Video game assets, book layouts, logos. She is very good at design.

<p style="text-align: center;">⁂</p>

The thing about meta-work is that it satisfies every feedback loop that normally protects against procrastination.

When I am doing meta-work, I am typing. I am solving problems—genuinely hard problems, actually, often harder than the "real" work. I am learning things. I experience the satisfaction of making things slightly more efficient for hypothetical future scenarios. I am not shipping the feature I was supposed to ship, but this fact is obscured by all the other activity.

This is what makes it so dangerous. You're busy. You're even *frustrated*, because getting nginx to proxy correctly through your Tailscale sidecar container is genuinely difficult. Your manager sees you working. You might even deploy something. It's just that the something you deploy is infrastructure for eventually deploying the thing you were originally asked to build.

Alexa cannot do this. If Alexa spends the day calibrating her monitor instead of designing a logo, there is no logo at the end of the day. The absence is conspicuous. Her client calls and asks where the logo is, and "I was optimizing my color workflow" is not an answer that anyone has ever accepted in the history of graphic design.

<p style="text-align: center;">⁂</p>

Software infrastructure is a series of gates before the Law.

You need to deploy an application. But first you need somewhere to deploy it. So you provision a server. But managing system dependencies is tedious, so you containerize. But orchestrating container rollout is tedious, so you set up Kubernetes. But managing Kubernetes is tedious, so you use a managed service. But configuring the managed service is tedious, so you use Terraform. But now you need CI/CD to run your Terraform, so you configure GitHub Actions. But your Actions need secrets, so you integrate with Vault. But Vault needs to be deployed somewhere...

Each gatekeeper assures you: the Law is just beyond. Each accepts your offerings and motions you to wait.

<p style="text-align: center;">⁂</p>

I think meta-work is attractive specifically to smart, conscientious people, because it is genuinely *harder* than regular work.

Configuring Kubernetes correctly is objectively more difficult than writing a CRUD endpoint. It requires understanding networking, Linux internals, distributed systems, YAML (a data format that somehow always ends up with a Turing-complete templating engine bolted onto it), and the specific theology of whoever designed your particular ingress controller.

This attracts the same personality type that participated in extracurricular science competitions because they were fun. In college, they took extra hard classes just to prove they could. We got really good at doing hard things. Unfortunately, "hardest" and "most valuable" are not synonyms, and this realization does not come naturally to people who have been rewarded for difficulty their entire lives.

<p style="text-align: center;">⁂</p>

The standard defense of software meta-work goes: software is uniquely complex, operates at uniquely high scale, and changes uniquely fast. You can't compare it to graphic design. A designer makes one logo at a time; a software system might serve ten million requests per second. You need orchestration and observability and twelve different monitoring dashboards.

This is true. Some systems genuinely need orchestration. Some problems only emerge at scale, and the infrastructure to handle them is real engineering, not theater.

And yet I notice that the argument proves too much. I don't have to look very far to find a company with 12 engineers, 47 microservices, and a full-time platform team of 3 people. At some point you have to ask whether the scale being economized actually exists, or whether you built the infrastructure first and then invented the scale to justify it.

<p style="text-align: center;">⁂</p>

Most meta-work is debt collection for application-level neglect. I have seen teams spend six figures worth of engineer-time planning infrastructure changes to solve problems that had never been profiled. Perhaps the target artifact was the Excalidraw diagram of the new architecture.

The alternative looks like SQLite. Between 2008 and 2015, the SQLite team made hundreds of tiny optimizations—1% here, 3% there. No new architecture. No caching layer. Just looking at what the code actually did and making it slightly better. The compound result was a 3x speedup.

<p style="text-align: center;">⁂</p>

There's an obvious objection here: maybe engineers who prefer meta-work are simply bad at application-level work. Specialization as cope.

But this doesn't hold up. I know plenty of engineers who are perfectly capable of writing efficient application code—and still drift toward infrastructure. The question isn't capability. It's incentive. Why is this drift *rewarded*?

Infrastructure is legible. It goes on your resume.

"Architected and deployed a multi-region Kubernetes cluster serving 50,000 requests per second with 99.99% uptime" is a sentence that gets you hired. "Made hundreds of small correct decisions that kept us on a monolith running on two big servers" is not a sentence at all. It's an absence. You cannot brag about the complexity you prevented, because the prevention is indistinguishable from the complexity never having been necessary in the first place.

Writing a genuinely efficient application is hard in ways that do not photograph well. You have to understand your data. You have to know what the database is doing under the hood. You have to think about memory layout and network round trips and user experience. None of this produces artifacts. There is no certification for "understood the problem before reaching for distributed systems." You cannot give a conference talk about the caching layer you didn't build.

Kubernetes has certifications. It has a logo. When you solve a Kubernetes problem, you can explain what you did to a recruiter who has never written code, and they will nod and write "Kubernetes experience" on their form. The mass of infrastructure follows career incentives, and career incentives point toward legible complexity the way water flows downhill.

<p style="text-align: center;">⁂</p>

I believe that a senior engineer's primary value is *preventing* infrastructure, not building it. Every caching layer not needed, every microservice not extracted, every Kubernetes cluster not provisioned—these are the senior engineer's true deliverables, invisible and therefore unrewarded.

Why unrewarded? Because the value is unprovable. You are looking at censored data. You only see outcomes for the paths you took, never the counterfactuals. The system that didn't need Kubernetes—would it have survived the traffic spike that never came? You cannot know. The uncertainty is not reducible.

And the loss function is asymmetric. If you approve a Kubernetes deployment and it goes badly, you followed industry best practices. If you approve a single-server architecture and it goes badly, you were reckless and naive and didn't you know this hasn't been best practice in fifteen years? The downside of unnecessary complexity is waste—regrettable, but survivable. The downside of insufficient complexity is blame. One of these costs your company money. The other costs you your job.

Under high uncertainty with asymmetric losses, the rational choice is to over-provision. Not because you believe the complexity is necessary, but because you cannot afford to be wrong in that direction. The math says: add the caching layer. The math says: deploy to Kubernetes. The math says: protect yourself.

This is how industries drift toward complexity. Not because anyone decides complexity is good, but because the incentive gradient points that way at every decision point, and over time, the integral accumulates. Everyone is doing the math correctly.

<p style="text-align: center;">⁂</p>

But you can't blame supply for providing something that's demanded.

Organizations value legibility over quality when the two conflict. This isn't unique to software. The assembly line didn't win because it made better cars than craftsmen. It won because it made *legible* cars—predictable, schedulable, decomposable into enumerable steps that could be taught to interchangeable workers and optimized by managers who had never touched a wrench. McDonald's did not become the world's largest restaurant company by making the best hamburger. It became the largest by making a hamburger that could be reliably produced by any teenager following a laminated set of instructions.

Legible mediocre work beats illegible good work, because the former can be planned around, budgeted for, and sold to the board. The latter cannot.

Engineer fungibility is downstream of this. The dream of interchangeable engineers—lose someone Friday, backfill them Monday, skills as Lego bricks—exists because it makes engineering legible to the organization. "We need three engineers with Kubernetes experience" is a sentence a VP can put in a budget proposal. "We'll ship by Q3 with this team composition" is a promise that can go on a roadmap. "We'll ship by Q3 if we find someone who really gets it" is not.

And yet: when something breaks badly enough, the org chart dissolves. Someone says "get me the person who actually understands this thing." The illegible expertise no one would plan around—because planning around it meant depending on someone who couldn't be replaced—is suddenly the only thing that matters.

But this is wartime. Peacetime is where careers are built, and peacetime rewards legibility. The escape hatch exists; it just isn't usable.

The Law is there. It has always been there. We are very busy studying the fleas of the gatekeepers.