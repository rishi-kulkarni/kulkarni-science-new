---
title: "Churn Risk Is a Conditional Rate: A Simpler Empirical Bayes Model"
date: 2026-08-26T00:00:00Z
lastmod: 2026-08-26T00:00:00Z
authors: ["Rishi Kulkarni"]
description: "My churn model answered the wrong question for two years, and every backtest said it was fine. The replacement is a roll-rate table with credibility shrinkage."
summary: "My old churn model measured how surprising a user's silence was against their own history. That's a real question with a real answer, but it isn't churn risk: it flagged regulars who took a week off and ignored light users who'd quietly stopped. It passed every backtest for two years; a confused user in a focus group is what caught it. The replacement is the table banks use for late accounts – bin users by how long they've been gone and how much they normally use the product, count who came back – with the same empirical Bayes shrinkage as before, pointed at the right quantity this time."
tags: ["statistical methods", "data analysis", "python", "bayesian statistics", "churn"]
keywords: ["churn prediction", "churn risk", "empirical Bayes", "conditional churn rate", "shrinkage estimation", "calibration", "p-values", "surprisal", "Bühlmann credibility", "customer retention", "retention analysis", "customer analytics"]
draft: true
math: true
toc: true
---

[My prior churn model](/blog/empirical-bayes-approach-to-churn/) answered the wrong question. The answer itself was fine – it asked whether a user's recent usage was alarming relative to their own history, estimated that with Empirical Bayes shrinkage on per-user Poisson rates, and the estimates held up in backtesting. I wrote at the time that it "actually answers the question your lifecycle marketing team is asking." It ran in production for about two years.

Then the marketing team ran a focus group with a handful of our heaviest users, and one of them brought up an email she'd gotten a few weeks back. It was a pitch for one of our other products, the kind we only send to users we've written off on the current one. She was confused by it. She had no plans to stop using what she was already using, and wanted to know why we thought she did. The marketing manager running the session didn't know either, and was concerned enough to bring it to me directly. The answer was that she'd taken a week off earlier that month, and the churn model had jumped at the chance to mark her as a churn risk.

Two years of good metrics, and one bad anecdote. I've come to think that combination should be read as a sign that the metrics aren't looking at the right thing.

The thing is, the model wasn't wrong. It measured how weird this week was for this user, and it did that fine. The problem is that "how weird is this week" is not a reason to do anything, and I called it churn risk anyway. Once a number is called churn risk, marketing is going to send churn emails to the people with high values. That's on me. Greenland has a paper on exactly this distinction[^greenland]: a number that tells you how far you are from some baseline is not the same as a number that tells you what to do, and a lot of p-value abuse is people quietly swapping the first for the second. I did the same thing with a column name.

The user from the focus group wasn't an exception. When I held the model's output up against what users actually did over the following month, the pattern was the same at every gap length: the index went up with how much someone normally used the product, and churn went down.

| gap since last activity | Q1 (light) | Q2 | Q3 | Q4 (heavy) |
|---|---|---|---|---|
| observed churn, 0–1 week | 0.35 | 0.25 | 0.12 | 0.07 |
| observed churn, 2–4 weeks | 0.55 | 0.50 | 0.40 | 0.30 |
| mean churn index, 2–4 weeks | 0.25 | 0.35 | 0.70 | 1.10 |

The users whose silence is most surprising are the regulars, and a regular is exactly the person most likely to come back. The same tight history that makes a week off look alarming is what predicts the return.

## Stealing from credit card companies

Fortunately, there's an abundance of prior art for this problem. As usual, it has a different name in every industry. Banks call theirs a roll-rate table – of the accounts that were 60 days late last month, what share went to 90? Split that by how risky the account looked to begin with, and you have a table that tells the bank how much money it should expect to lose on those accounts next month.

We can borrow this idea without much adulteration. Our two axes are how long it's been since the user last did anything, and how much they typically use the product, weighted toward the last few months. Bin each axis and every user lands in one cell. To fill in a cell, we look at everyone who was in it a month ago and count what share of them continued to do nothing over the next month. If 9 out of 10 didn't come back, everyone in that cell today gets a 90% chance of not coming back. That's a churn rate conditional on how long they've been gone and how much they usually use the product. It's a simple model, and it answers marketing's question directly.

You might imagine that some of these cells end up without many users in them. Heavy users rarely go a month without showing up, so that cell might hold a dozen people, and its rate is whatever those dozen happened to do. The raw table is right on average and noisy in the corners, which is unfortunately where marketing's cutoffs are.

My instinct at this point was to give up on the table and fit a proper survival model. But marketing had been emailing the wrong people for two years, and I wanted the number fixed that week, not after I'd validated a new model. The quick move is to borrow from the other cells in the same table.

Fortunately, this idea has a lot of prior art too. Insurers have had the small-cell problem for a century: a class of policies has its own loss history, but not enough of it to price off of. Whitney (1918)[^whitney] suggested blending the class's rate with the book-wide rate, weighted by how much data the class had, and Bühlmann (1967)[^buhlmann] formalized it. The weight on the cell's own rate works out to $n / (n + K)$, so a big cell mostly gets its own rate and a tiny one mostly gets the overall rate. In code:

```python
rate = (churned + K * overall) / (n + K)
```

This is the BLUP for each cell's churn rate[^robinson], with K tuned by the method of moments. Since K is estimated from the data, it's also an empirical Bayes technique – actuaries call it credibility theory. It's the same shrinkage formula my first churn model used. Instead of shrinking to better predict activity rate at the user level, we're shrinking to better predict churn rate at the cell level.

Is it better? Same test as the old model, except this time the thing being checked is the thing the column is named after: fit on one month, score the next without looking at it, and see if the groups the model calls 80% actually churn at 80%.

| predicted band | n | predicted | observed |
|---|---|---|---|
| <0.50 | 350 | 0.23 | 0.22 |
| 0.50–0.68 | 125 | 0.59 | 0.60 |
| 0.68–0.90 | 335 | 0.80 | 0.82 |
| ≥0.90 | 190 | 0.91 | 0.93 |

It is, though mostly by construction: each cell is a histogram of the outcome, so the only way it drifts is if next month's users look different from last month's. What the check is really for is K. If the shrinkage were too strong, the top band would come in under its prediction, and it doesn't. I think a model like this, built from techniques insurers have used for a century, is the baseline that anything fancier has to beat. I did try a few additional features, and none of them moved the Brier score by more than a rounding error. Almost all of the signal is "how long have they been gone" and "how much do they normally use the product."

## Did it work?

The user from the focus group now sits in the short-gap, heavy-use cell, where about 7 in 100 don't come back. She won't be getting pitched our other products on the theory that she's finished with this one. The people who get it instead are the ones the old model never flagged: light users who've been gone a few weeks, about half of whom won't come back.

We also added a monitor on the heavy-user cohort specifically, since that's where we got burned. Model monitoring is like a test suite: you're always fighting your previous wars. The old model looked fine on average for two years. This one is fine on average and fine on heavy users. Maybe it'll be wrong about some other group that I don't even know to look out for yet[^hullman].

[^greenland]: Greenland, S. (2023). "Divergence versus decision p-values: A distinction worth making in theory and keeping in practice." *Scandinavian Journal of Statistics*, 50(1), 54–88.
[^whitney]: Whitney, A. W. (1918). "The Theory of Experience Rating". *Proceedings of the Casualty Actuarial Society*, 4, 274–292.
[^buhlmann]: Bühlmann, H. (1967). "Experience Rating and Credibility". *ASTIN Bulletin*, 4(3), 199–207.
[^robinson]: Robinson, G. K. (1991). "That BLUP is a Good Thing: The Estimation of Random Effects". *Statistical Science*, 6(1), 15–51.
[^hullman]: Multicalibration is the theoretical fix: calibrate on every group you could define in advance. Jessica Hullman has a pair of posts on why it's mostly out of reach in practice: the data needed grows exponentially with the groups you want covered, and on tabular data simple post-hoc corrections do almost as well. [Calibration for everyone and every decision problem, maybe](https://statmodeling.stat.columbia.edu/2024/11/15/calibration-for-everyone-and-every-decision-maybe/) and [Practical issues with calibration for every group and every decision problem](https://statmodeling.stat.columbia.edu/2024/11/26/practical-issues-with-calibration-for-every-group-and-every-decision-problem/), *Statistical Modeling, Causal Inference, and Social Science*, November 2024.

