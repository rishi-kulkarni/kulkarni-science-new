---
title: "An Empirical Bayes Approach to Churn Estimation"
date: 2025-08-03T00:00:00Z
lastmod: 2025-08-03T00:00:00Z
authors: ["Rishi Kulkarni"]
description: "A practical guide to building churn models using Empirical Bayes methods that simultaneously improve individual user estimates and control for multiple comparisons."
abstract: "Traditional churn models often overthink the problem. This post presents a simple Empirical Bayes approach that estimates user-specific activity rates, naturally handles multiple comparisons through shrinkage, and directly answers the business question: who needs intervention now?"
tags: ["statistical-methods", "data-analysis", "python", "hypothesis-testing", "bayesian-statistics"]
keywords: ["Empirical Bayes", "churn prediction", "customer retention", "shrinkage estimation", "multiple comparisons", "Poisson process", "James-Stein estimator", "lifecycle marketing", "user engagement", "statistical modeling", "Python implementation", "business analytics", "retention analysis", "customer analytics", "Bayesian shrinkage"]
math: true
toc: true
---

## Everyone Wants a Churn Model

Rarely do I ever get asked to make churn estimates for someone who needs to bring the full power of a proportional hazards model to bear. Besides, the person asking for churn estimates doesn't actually want to know "what is the probability someone churns eventually?" (Spoiler: it's 1.)

Usually, it's someone in lifecycle marketing or account management trying to figure out "who should I spend resources sending outreach and incentives to?"

Luckily, this more-salient question is actually a straightforward test of a large family of hypotheses - for each user, if we consider their historical usage patterns, is their recent usage (or lack thereof) sufficiently alarming to warrant intervention? The null hypothesis is that their recent usage is no different than their historical usage, and the alternative is that it's lower. We can fit a Poisson process per user and pretty easily come up with a probability that they haven't deviated from their personal historical baseline.

Let's make this concrete with an example. Take a power user who normally logs in 5 times per week but has been silent for 3 days - under their historical Poisson rate of 0.71 events per day, the probability of observing 3 or more days of silence is about 0.12. Concerning perhaps, but not crazy. Now take a daily user with the same 3-day gap; the probability drops to 0.05, which starts to look genuinely alarming. Same silence period, completely different levels of concern based on personal baselines.

## Nobody Wants To Think About Multiple Comparisons

This approach has a pretty major problem, of course - thinking about this like a massive set of hypothesis tests means we also need to correct for multiple comparisons, or else we'll send our coworker chasing a bunch of false leads. 

If you're testing 10,000 users at α = 0.05, you'll flag 500 completely normal users as "churning" just by random chance. You intervene on these users, they naturally regress to their mean usage pattern (because they were never actually disengaging), and suddenly your retention campaign has a near-perfect success rate on these 500 users. Marketing gets to claim a huge win, everyone pats themselves on the back, and nobody realizes they just spent money on users who were never at risk. When retention campaigns report massive success rates, you should be deeply skeptical - churn is hard, and you should have a strong prior against being way better than everyone else in the industry at combating it.

So how do we avoid this trap? There are two ways of handling multiple comparisons - we could bias our decision function toward inaction (using Bonferroni corrections, controlling false discovery rate, or other such adjustments), or we could bias our estimates of the users' historical usage patterns. My gut leans toward providing better estimates that can be consumed by various business functions to make their own decisions, rather than hard-coding significance thresholds that might not match business needs. But what should we bias our estimates toward?

## Empirical Bayes to the Rescue

Well, technically toward anything - James and Stein (1961) proved that when estimating three or more normal means, you can always beat the unbiased estimator by shrinking toward *any* fixed point, even terrible ones[^2]. While shrinking toward your phone number technically dominates the MLE, shrinking toward the grand mean usually works best in practice.

We've modeled each user as having their own Poisson rate of interacting with our product, and conveniently the conjugate prior to the Poisson distribution is the gamma distribution. Our naive maximum likelihood estimates are equivalent to estimating these Poisson rates with an improper Gamma(0, 0) prior - essentially saying we know nothing. We can do much better by estimating what Gamma-Poisson distribution best fits the data as a whole, then estimating individual Poisson rates by setting the gamma prior equal to this fitted population distribution.

The Gamma-Poisson distribution is also known as the Negative Binomial distribution (and is technically a two-level hierarchical model), so we can fit it with run-of-the-mill scipy distribution functions:

```python
from scipy.stats import nbinom
from scipy.optimize import minimize
import numpy as np

def fit_population_params(events, days):
    """Fit Gamma(α, β) parameters for population distribution"""
    def neg_loglik(params):
        alpha, beta = params
        # Negative binomial parameterization for each user
        p = beta / (beta + days)
        return -np.sum(nbinom.logpmf(events, n=alpha, p=p))
    
    result = minimize(neg_loglik, x0=[1, 1], 
                     bounds=[(0.01, 100), (0.01, 100)])
    return result.x

# Fit once on all users
alpha, beta = fit_population_params(user_events, user_days)

# Compute posterior rate estimate and surprisal score
posterior_rate = (user_events + alpha) / (user_days + beta)
# For Poisson, -log(P(0 events in t days)) = λt (expected events)
surprisal_score = posterior_rate * days_silent
```

This is, in effect, going to shrink all our estimates toward the grand mean - instead of assuming a user with no data is equally likely to have any usage pattern from zero to infinity, we assume they're probably somewhere near average. Much more reasonable when you think about it. The "surprisal score" naming follows Greenland's framing of p-values as measures of information surprisal[^1] - the higher the score, the more surprising (and concerning) the user's silence.

## Tabula Rasa Is Worse Than Assuming Everyone Is Average

Efron and Morris (1975) illustrated this beautifully with baseball batting averages[^3]. Early in the season after just 45 at-bats, observed batting averages range wildly from .150 to .400, but we know true batting talent doesn't vary nearly that much. The best estimate for each player's true ability isn't their raw average but rather a weighted combination of their personal data and the league average, with the weights determined by how much data we have on that specific player.

Same principle applies here - a power user with 1000 days of history gets almost no shrinkage because we're confident in their pattern, while a new user with 10 days of data gets pulled strongly toward the population mean. This approach simultaneously reduces false positives from multiple testing AND gives us better individual estimates by borrowing strength across users. 

As Gelman, Hill, and Yajima (2012) explain, multilevel models naturally handle multiple comparisons through partial pooling - the same shrinkage that improves our estimates also controls false discovery rates[^4]. We don't need explicit multiple comparison corrections because the shrinkage naturally makes us more conservative about flagging users with limited data.

## Implementation and Validation

The full implementation scores all users each Monday morning in mere milliseconds:

```python
from datetime import datetime

def score_users_for_retention(df):
    # Fit population parameters once
    alpha, beta = fit_population_params(df['events'], df['days_active'])
    
    # Compute shrunken rate estimates
    df['rate_estimate'] = (df['events'] + alpha) / (df['days_active'] + beta)
    
    # Score based on expected events during silence
    df['days_silent'] = (datetime.now() - df['last_seen']).dt.days
    df['surprisal_score'] = df['rate_estimate'] * df['days_silent']
    
    # Return ranked list for intervention
    return df.nlargest(200, 'surprisal_score')[['user_id', 'surprisal_score', 'days_silent']]
```

You should validate how well these simplifying assumptions fit your data - the cohort of users that the model estimates will interact with your product 4 times per week really should, on average, interact with your product 4 times per week in the period after you make your predictions. A simple backtest works well: estimate rates for all users on Monday, don't intervene on any of them, then check the following week. If users with estimated rate λ have, on average, λ interactions, your model is doing its job.

This simple baseline is fundamentally sound and beats most complex models for the actual decision at hand. The sophistication here isn't in the implementation (which is dead simple) but in recognizing that the business question "who needs attention?" maps cleanly to a well-studied statistical problem of simultaneous estimation, which empirical Bayes solves elegantly.

You can always add covariates, build segment-specific models, or account for seasonality later. For now, you've got something that ships in an afternoon and actually answers the question your lifecycle marketing team is asking.

[^1]: Greenland, S. (2019). "Valid P-Values Behave Exactly as They Should: Some Misleading Criticisms of P-Values and Their Resolution With S-Values". *The American Statistician*, 73(sup1), 106-114.

[^2]: James, W. and Stein, C. (1961). "Estimation with Quadratic Loss". *Proceedings of the Fourth Berkeley Symposium on Mathematical Statistics and Probability*, 1, 361-379.

[^3]: Efron, B. and Morris, C. (1975). "Data Analysis Using Stein's Estimator and its Generalizations". *Journal of the American Statistical Association*, 70(350), 311-319.

[^4]: Gelman, A., Hill, J., and Yajima, M. (2012). "Why We (Usually) Don't Have to Worry About Multiple Comparisons". *Journal of Research on Educational Effectiveness*, 5(2), 189-211.