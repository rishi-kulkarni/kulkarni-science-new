---
title: "Notes on \"From Predictions to Decisions\" (Wen et al., 2022)"
date: 2026-08-12T00:00:00Z
lastmod: 2026-08-12T00:00:00Z
draft: false
description: "Wen et al. prove that decision quality rides on joint predictive distributions, not marginals. That lends more support to the case for hybrid bandits."
abstract: "A reading of Wen et al.'s paper on joint predictive distributions in sequential decision-making, and what it implies for the disjoint-vs-hybrid choice in contextual bandits: one model per arm is the independence forecaster from their motivating example, and the exact joint it discards is free in the conjugate linear setting."
summary: "Wen et al. show two forecasters with identical marginal predictions can make arbitrarily different decisions. A disjoint contextual bandit (one model per arm) is exactly their independence forecaster. In conjugate linear models the joint is exact and free, and partial pooling through a shared component gets it back."
tags: ["bayesian statistics", "machine learning", "bandits", "statistical methods"]
keywords: ["hybrid linear bandits", "LinUCB hybrid vs disjoint", "joint predictive distributions", "contextual bandits", "Thompson sampling", "one model per arm", "shared model", "disjoint bandits", "partial pooling", "epistemic neural networks"]
math: true
toc: true
authors: ["Rishi Kulkarni"]
sitemap:
  changefreq: "monthly"
  priority: 0.8
---

Every contextual bandit system starts with the same decision. You have $K$ actions and a context vector, and you can either train one model per arm or one shared model with the arm encoded in the features. Li et al.'s LinUCB paper calls these the disjoint and hybrid approaches, and disjoint is clearly the path of least resistance: it's Algorithm 1 in the paper, it's how the k-armed bandit from every textbook generalizes once contexts show up, and it's what my own [library](https://github.com/rishi-kulkarni/bayesianbandits) does by default; `ContextualAgent` gives each arm its own learner. Even when you learn toy bandit examples in class, it's with independent arms, so I followed the pedagogy without thinking very hard about it.

"From Predictions to Decisions: The Importance of Joint Predictive Distributions" (Wen et al., 2022) is a theory paper about what properties of a model best support good sequential decision-making. It makes a strong argument against the disjoint default, and so I'll be reaching for hybrid bandits from here on.

## Decisions depend on the joint, not the marginals

The motivating example is two forecasters predicting a coin. Both currently predict it'll land on heads with probability 1/3. They have identical marginals, indistinguishable by any accuracy metric or calibration plot. But forecaster 1 believes the flips are independent, while forecaster 2 believes the coin is rigged: it either always lands heads or always lands tails, with prior probability 1/3 on the first. For prediction, the two are equivalent. For decision-making, they are nothing alike. Suppose observing a flip costs something. To forecaster 2, the first flip is priceless because it resolves its two hypotheses completely. To forecaster 1, it is one more data point among many. Everything that separates these two agents lives in the joint distribution over multiple outcomes.

The paper's formal results say this is not an artifact of this toy example. For $K$-armed bandits, they bound the regret of Thompson sampling run from an agent's predictive distribution in terms of the quality of the agent's *joint* predictions over multiple outcomes. Marginal accuracy alone can't tell informative actions from uninformative ones, and that's the distinction your exploration policy has to make. This is the theory end of the epistemic neural network program: the epinet (Osband et al., 2023) exists because deep models don't produce usable joint predictives natively, and the group's Testbed work evaluates agents on joint prediction quality because marginal quality doesn't track decision performance. I found the Testbed experiments a bit underpowered, but the algebraic argument holds regardless.

## Prefer hybrid linear bandits

Here is what the paper means for bandit systems. Thompson sampling explores by sampling: each round you draw coefficients from the posterior and play the arm the draw favors. The draw is supposed to be one coherent hypothesis about the world. Fit one model per arm and you have built forecaster 1: the posterior across arms factorizes, and each observation updates only its own arm's model.

What does "no assumptions" mean here, anyway? Doesn't "separate models" feel like the assumption-free choice? As a prior, they say the arms' coefficients are perfectly uncorrelated. Any other level of correlation would be an ordinary modeling choice that data can correct over time. By picking separate models, the arms never exchange information, so there is nothing to correct and no way to discover you were wrong.

The costs show up in two places, and one example shows both. Suppose there's a seasonality effect you're still uncertain about, like how much engagement drops on weekends. Weekends happen to every arm at once, so a shared model samples one value of the effect per round and every arm's sampled reward dips together. Separate models sample it independently for each arm: in one round, arm $A$'s draw can assume weekends are dead while arm $B$'s assumes they're fine. Nobody believes this world exists, but the modeling choice of independent arms forces it into being. This won't show up on calibration metrics, either: each arm's marginal is honest about what that arm's model knows, and the incoherence lives across arms.

The second cost is learning speed, and it's the same structure seen from the update side. When a shared model watches arm $A$'s engagement drop on a Saturday, it updates its weekend belief for every arm at once. Separate models can't do this: each arm learns the weekend dip only from its own weekends. Well-trafficked arms get there eventually; the long tail may never see enough weekends.

To be more precise: stack all $K$ arms' coefficients into one vector with posterior covariance $\boldsymbol{\Sigma}$; one observation at arm $A$ reduces the predictive variance at arm $B$ by

$$\frac{\left(\mathbf{z}_B^\top \boldsymbol{\Sigma} \mathbf{z}_A\right)^2}{\sigma^2 + \mathbf{z}_A^\top \boldsymbol{\Sigma} \mathbf{z}_A}$$

The numerator is the squared predictive covariance between the two arms, or how much one arm's data can teach you about another. Separate models set this quantity to zero for every pair of arms, so no cross-arm learning is possible. (LinUCB pays the update-time cost, too, as its confidence bounds come from the same posterior. The draw-coherence problem is Thompson sampling's alone, though: UCB scores each arm by its own mean and its own uncertainty, so its decisions depend only on the marginals.[^1])

Eventually, these costs wash out. With enough observations on every arm the two make the same decisions. But few observations per arm is why you're using a bandit, anyway; if you had plenty of data on every arm, you wouldn't be exploring.

What made me actually change my default is how lopsided the costs are. Osband et al. built the epinet architecture because deep networks can't otherwise produce usable joint predictives. A conjugate linear model produces the exact joint without much fuss, further supporting my strong prior that conjugate linear models give you an unreasonable amount out of the box.

## Pooling is one learnable number

The hybrid alternative is ordinary partial pooling. Each arm's coefficients are a shared effect plus an arm-specific deviation, $\boldsymbol{\theta}_a = \boldsymbol{\beta} + \boldsymbol{\delta}_a$, with prior variances $v$ and $s^2$. Nothing about this is exotic; it's the same hierarchical model statisticians have always used. The useful part is what happens when you hold $v + s^2$ fixed at the ridge prior you already use, $1/\lambda$. Every arm's marginal prior stays exactly what it was, and the only thing left to decide is the split: $\rho = v/(v + s^2)$, the prior correlation between arms. Set $\rho = 0$ and you have your $K$ independent ridge regressions. Set $\rho = 1$ and you have one pooled regression.

A bandit is a prediction machine, so shrinkage via partial pooling is a pretty safe default. Shrinkage gives sparse arms better estimates than their own data could earn, which is why mixed models exist, and better per-arm predictions buy better decisions directly. That alone justifies the switch, and your existing scoring metrics will show it.

The part they won't show comes from what the shared component lets you write down. You're now free to encode structure that was never per-arm to begin with: seasonality, day-of-week effects, anything every arm experiences together becomes a coefficient in $\boldsymbol{\beta}$ instead of $K$ private rediscoveries. At any $\rho$ above zero the stacked covariance stops being block-diagonal, so one draw of $\boldsymbol{\beta}$ moves every arm's Saturday together, and one arm's Saturday observation updates the weekend belief everywhere.

You may already be running a version of this: shared features plus a per-arm copy of them, thrown into a single ridge regression. I've [written about](/blog/approximate-hierarchical-bayes-online-learning/) feature-encoded hierarchical models before, which give you partial pooling through shrinkage. But run the numbers and it's pooling at a specific ratio: with equal column scales, the implied correlation is exactly $1/2$, and each arm's prior variance is $2/\lambda$. You can get around this with two column scalings, because scaling a column by $c$ is the same as giving its coefficient a prior variance of $c^2/\lambda$. Multiply the shared block by $\sqrt{\rho}$ and the per-arm blocks by $\sqrt{1-\rho}$, and the implied coefficient for each arm is $\sqrt{\rho}\,\boldsymbol{\beta} + \sqrt{1-\rho}\,\boldsymbol{\delta}_a$: marginal variance back to $1/\lambda$, cross-arm correlation exactly $\rho$. You don't really need to get $\rho$ right, it just serves as a warm start. At any value above zero, the posterior adapts as usual.

In [bayesianbandits](https://github.com/rishi-kulkarni/bayesianbandits), this is `LipschitzContextualAgent` with a featurizer that builds the scaled design: one shared learner, one draw of the stacked parameters per round, every arm scored against the same draw. The [hybrid bandits tutorial](https://bayesianbandits.readthedocs.io/en/latest/notebooks/hybrid-bandits.html) walks through a complete example.

## Marginal metrics alone don't promise good decisions

I've usually encouraged proper scoring rules for auditing prediction quality in bandits. Unfortunately, these are marginal audits, and the coin example exists because marginal audits can't tell the two forecasters apart.

So the modeling side is settled for me. The hierarchy works the same way for GLMs and kernel models; linear is just where the joint is exact. The evaluation side is unfortunately not yet clear. What metrics _do_ you use to assay joint quality? Are they portable?

[^1]: This is true even when the bound is computed by sampling: a per-arm percentile of a thousand joint posterior draws is still a marginal quantity, if you shuffle each arm's samples independently, nothing changes. The joint only matters when arms are compared within a single draw, which is what Thompson sampling's argmax does. Algorithms that maintain no posterior at all, like EXP3's exponential weights or SquareCB's inverse-gap weighting over a point-prediction oracle, have no joint to lose, so none of this applies to them. A shared reward model still pools means for SquareCB's oracle, but that's an argument about regression, not about uncertainty.

---

## References

Li, L., Chu, W., Langford, J., & Schapire, R. E. (2010). A Contextual-Bandit Approach to Personalized News Article Recommendation. *Proceedings of the 19th International Conference on World Wide Web (WWW)*. https://arxiv.org/abs/1003.0146

Wen, Z., Osband, I., Qin, C., Lu, X., Ibrahimi, M., Dwaracherla, V., Asghari, S. M., & Van Roy, B. (2022). From Predictions to Decisions: The Importance of Joint Predictive Distributions. arXiv:2107.09224. https://arxiv.org/abs/2107.09224

Osband, I., Wen, Z., Asghari, S. M., Dwaracherla, V., Ibrahimi, M., Lu, X., & Van Roy, B. (2023). Epistemic Neural Networks. *Advances in Neural Information Processing Systems (NeurIPS)*. https://arxiv.org/abs/2107.08924
