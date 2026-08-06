---
title: "Slow Code Makes Product Decisions for You"
date: 2026-08-05T00:00:00Z
lastmod: 2026-08-05T00:00:00Z
authors: ["Rishi Kulkarni"]
description: "A timeout quietly set our page size, our UX, and our roadmap for years. On finally reading a feared function."
summary: "Our most-hit endpoint took 200 milliseconds per shift, so someone capped it at one page of results. The cap ran for years and quietly made product decisions nobody agreed to: an eleven-item shelf, a two-second page, and features that never became ideas. Then a blocked MySQL upgrade forced us to finally read the function."
tags: ["software engineering", "performance", "legacy code", "databases"]
keywords: ["performance optimization", "n+1 queries", "mysql query cache", "legacy code", "refactoring", "technical debt", "database performance", "product development", "query optimization"]
draft: false
toc: false
---

Our most-hit endpoint answered one question: should this temp be shown this shift? Answering took about 200 milliseconds per shift – a for-loop over every business rule we'd ever had, each one appended by whoever needed it, none ever read again. At five open shifts, that's a fast enough page. At thirty thousand, it's a timeout. So someone "fixed" it: evaluate until you have one page of eleven shifts, then stop unless they ask for another page. 

That line shipped in an afternoon and ran for years.

## The cap

Start with the obvious cost. The main view of the app took two seconds to load and showed eleven shifts. There was pagination, technically – the next eleven cost another two seconds, and the eleven after that another two, so with thirty thousand shifts open, the full catalog sat three thousand page-turns away. Nobody was ever going to see it. Our marketplace's entire premise was matching people to shifts, and the shelf held eleven items at a time: the eleven soonest, by start time. A reasonable default! Also the only view anyone could afford, because filtering and sorting lived server-side, inside the same slow function. Want closest instead of soonest? Two seconds. Best-paying? Two more. Want to book a shift for next week, when you're back from vacation? Two more. Nobody liked this, and nobody could name the decision that caused it, because there hadn't been one. There had been a performance problem. 

It wasn't just the user experience that suffered from this. Say a temp writes in: I can see the Tuesday shift at this facility but not the Saturday one – why? Great question. We had no idea. Maybe a rule killed the Saturday shift; maybe it just hadn't been evaluated. From the outside those look identical, and nothing we recorded could tell them apart – the function never evaluated a shift until someone paged to it, and you can't log why a shift was eliminated if you never looked at it. So when visibility bugs came up (and they came up), debugging meant reading a function nobody had read in years and running it in your head. Slow work. Mostly, it just didn't happen unless someone in Sales or Product started ringing alarm bells after talking with users. Not a great observability pipeline. 

And the function itself stayed slow, because the cap had removed all the pressure to make it fast. It was old, load-bearing, untested – and it worked, for some definition of "worked." Every incentive pointed the same way: don't touch it.

## MySQL 8

Funnily enough, the only reason 200 milliseconds a shift was ever survivable was MySQL's query cache, quietly absorbing most of the damage. All those n+1s and repeated lookups inside the loop? Mostly cache hits. We never decided that either.

Then MySQL 8 removed the query cache.[^1] The MySQL team had their reasons, and their reasons were, roughly, that the cache let people ship queries like ours. Fair. But now our upgrade was blocked: without the cache, the database couldn't carry the load this one function generated.

The proposal on the table was Redis. This is the respectable move and it would have worked, in the sense that the previous cache had worked. The queries stay bad, the function stays unread, and everyone meets back here at the next forced migration, one layer deeper.

The counter-pitch: fix the queries instead, scoped to this one function. Nobody could argue these query patterns were reasonable, and everyone knew the playbook for fixing them. And because we were in crunch time, already paying for extended support... we decided to fix the queries. 

## The fix

Three of us took it on. We read the function top to bottom, in the moment – and as far as we could tell, we were the first in quite a long time. This was pre-LLM explosion, too, so we had to be our own summarization layer. 

The queries were the easy part. The problems were exactly what you'd guess – n+1s, lookups that should've been batched, the same work repeated in loops that never shared results – and fixing them took no clever SQL at all. Admittedly, window functions would have helped, but they were the promised land itself: they lived in MySQL 8, on the far side of the very upgrade we were trying to unblock. What it took was reorganizing the code: lifting work up and out of the loop, piece by piece, so the loop got thinner with every release. The hard part was everything around that: business logic with no tests, hauling a decade of accumulated behavior that customers depended on, some of which nobody could confirm was on purpose. I spent a lot of time gnashing my teeth over this – surely it would have been easier for the person writing each query to just write it properly.

Except it wouldn't have been. The function was feared long before we got to it: no tests, no owner, nobody left who understood the whole thing – and 100% business-critical. So everyone who had to add a rule made the same rational move: touch as little as possible. And the minimal touch, the smallest diff that could possibly work, is a point query inside the enormous loop. Batching your lookup means restructuring code you're scared of; a one-row query means leaving everything else alone. Every n+1 in that function was somebody's act of self-defense. It's not that we were fearless, either – it was just that a crisis gave us carte blanche to tear this particular hedge up. 

The same fear had been fossilizing bugs, too – nobody afraid to touch a function fixes anything inside it. We found plenty. And every one triggered the same recurring scene: the code plainly intends one thing, production plainly does another, and the gap has been shipping for years. Which raises an uncomfortable question – is a bug still a bug once it's old enough that customers have built their routines on top of it?[^2] You can't answer that from the code. So we'd chase intent up the chain: the commit, the ticket behind the commit, the PM behind the ticket – who, more than once, had left the company years ago. At the end of the chain there was often nobody. So we'd make the call ourselves, write a test to pin down whichever answer we picked, and move on.

So the method was conservative to the point of tedium. Understand a piece. Write the tests it should always have had. Change a few things, release, watch. Repeat. We had about three months and only a handful of release windows to spend, so each release carried a pile of high-confidence changes and, at most, one scary one. If something broke, there would only ever be one suspect.

We still broke production once – a release that relied on a mistaken understanding of PHP's `DateTime::modify` hid three weeks of shifts from a slice of users. And no alert caught it, either; we learned about it the way this function had always delivered its bad news: a user ticket, working its way through tech support. That part sucked. We owned it and moved on. The discipline still paid for itself – one scary change in the release meant one suspect, and rollback was a single revert. 

By the end, a page held a thousand shifts instead of eleven and loaded in 200 milliseconds instead of two seconds – the function evaluating a thousand shifts in the time it used to spend on one. Database load fell by half, and the MySQL upgrade sailed through.

## Aftermath

With the cap gone, the API could hand back a thousand shifts in one call. The mobile team – who had spent years designing around an eleven-item, two-second endpoint – pulled filtering and sorting into the client, where they'd always belonged, and the app got fast in a way no backend change alone could have managed. Then they started building things that had never appeared on any roadmap. A calendar view, because you can draw a calendar when you actually have the data. Bulk accept, because accepting shifts in bulk means something when there are a thousand of them and nothing when there are eleven. The week after bulk accept shipped, temps accepted more shifts than in any week in the previous year.

None of those features had ever been proposed and rejected. They had never been proposed. Against an eleven-option endpoint they weren't bad ideas; they weren't ideas at all. The cap hadn't been deprioritizing product work. It had been deleting product work upstream of anyone's imagination, which is why it never showed up as a cost.

That's the thing I believe about performance: it's not just about making the product feel better, it's about enabling the product to be more than it is. Nobody designs features for an endpoint that can't serve them. The imagination does the budget math silently, and slow infrastructure gets priced in as "impossible" before anything reaches a whiteboard.[^3]

## Coda

People quote Knuth[^4] at stories like this, usually on behalf of the cap. But nothing here was ever optimized, prematurely or otherwise. The function was simply never read; for years, nothing forced anyone to look, and everything discouraged it. What I'd tell that earlier version of us isn't "write better queries." I mean, we should, but not just for its own sake. It's that the bill for slow software doesn't only arrive as latency. It arrives in the ideas nobody has. The modal PM (a perfectly good PM!) imagines about one step past whatever bricks your architecture hands them. Hand them an eleven-item, two-second shelf, and the bold idea is a recommendation engine to decide who gets the eleven coveted slots. Hand them a thousand shifts in 200 milliseconds, and they'll rebuild the marketplace for you.

[^1]: [The official announcement](https://dev.mysql.com/blog-archive/mysql-8-0-retiring-support-for-the-query-cache/) puts it more politely – it didn't scale, and it had been off by default since 5.6 – but I stand by my paraphrase.

[^2]: This question has a name – [Hyrum's Law](https://www.hyrumslaw.com/): with enough users, "all observable behaviors of your system will be depended on by somebody," whatever the contract says.

[^3]: Nelson Elhage [wrote the user-side version of this](https://blog.nelhage.com/post/reflections-on-performance/): fast tools don't just let people do the same tasks faster, they change which tasks people do at all. Ours is something like a corollary – before performance changes what users do, it changes what anyone thinks to build for them.

[^4]: From "Structured Programming with go to Statements" (1974). Nobody quotes the next sentence: "Yet we should not pass up our opportunities in that critical 3%."
