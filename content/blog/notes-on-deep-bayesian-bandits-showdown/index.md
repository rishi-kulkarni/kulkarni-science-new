---
title: "Notes on \"Deep Bayesian Bandits Showdown\" (Riquelme et al., 2018)"
date: 2026-01-31T00:00:00Z
lastmod: 2026-01-31T00:00:00Z
authors: ["Rishi Kulkarni"]
description: "Why conjugate Bayesian linear regression keeps winning in bandit systems, and what a 2018 Google Brain benchmark says about fancy deep Bayesian alternatives."
abstract: "A reading of Riquelme et al.'s ICLR 2018 benchmark comparing deep Bayesian methods for Thompson sampling. The paper finds that exact conjugate linear regression and a simple neural-linear hybrid outperform variational inference, MC Dropout, and SGLD — validating the engineering case for conjugate models in sequential decision systems."
tags: ["bayesian statistics", "machine learning", "bandits", "statistical methods"]
keywords: ["Thompson sampling", "contextual bandits", "Bayesian linear regression", "conjugate models", "normal-inverse-gamma", "variational inference", "MC Dropout", "SGLD", "NeuralLinear", "deep Bayesian", "uncertainty quantification", "exploration-exploitation"]
math: true
toc: true
---

I probably overuse the normal-inverse-gamma posterior. Every time I build a bandit system, every time I need uncertainty quantification for sequential decisions, I end up back at conjugate linear regression.

The engineering case is quite compelling on its own. Conjugate models give you upfront guarantees about operational characteristics. You store sufficient statistics — a precision matrix and weighted sum — not the data itself, so memory is O(d²) in feature dimension, independent of how many observations you've seen. Each observation is a rank-1 update to the precision matrix, O(d²) whether it's your thousandth or your ten millionth. Drawing from the posterior is a Cholesky decomposition and a matrix-vector multiply; you know exactly how long it takes before you deploy.

This matters when other engineers on your team need to mentally model performance characteristics of your machine learning system. They don't need to understand convergence diagnostics or when to retrain or what it means if the ELBO plateaus. The interface is just "call update with new data, call sample when you need a decision." Consistent cost, consistent behavior, no hidden state that might degrade over time.

But I always wonder if I'm leaving statistical performance on the table.

The literature contains much fancier techniques I could be using – variational inference over neural network weights, or MC Dropout, or SGLD, or bootstrapped ensembles. Flexible function approximation with principled uncertainty — learn any reward function, get calibrated posteriors too. The theory papers are beautiful. If they work as advertised, I'm giving up a lot.

I'll be honest: I've never actually used these in production. Every time I've looked seriously at them, I hit some computational inconvenience I couldn't get around, or something that made me uneasy about letting the system run indefinitely without close monitoring. MCMC has unknowable convergence time. Variational inference needs periodic retraining of uncertain duration. Ensembles mean maintaining N copies of a model. These are carrying costs, and they reduce my team's capacity to do other work, so I end up avoiding them.

So I go back to conjugate models because I trust them to behave. But that means I've never actually tested whether I'm paying a statistical cost for the engineering simplicity. I made the choice on operational grounds and hoped I wasn't giving up too much.

I read a 2018 paper from Google Brain that suggests I'm not — and helped me articulate why the simple approach might actually be correct for these problems.

## You Need Good Predictions, Not Perfect Posteriors

Multi-armed bandits as applied to real business problems are fundamentally forecasting problems. Contextual (many related reward functions), anytime (no known horizon), and nonstationary (the world drifts) forecasting problems. You need to predict what reward you'll get from each action, with enough uncertainty quantification that Thompson sampling explores appropriately.

You don't actually need to recover the true posterior over model parameters. You need your predictive distribution to be calibrated — when you say there's a 70% chance action A beats action B, you want that to be right about 70% of the time. The parameters are a means to an end.

This reframes what "misspecification" means. A linear model is obviously wrong if the mean reward is a nonlinear function of the context. But if the linear model produces calibrated predictions over the range of actions you care about, it's doing its job. Meanwhile, a neural network might be "a better approximation of the true function" in some eventual sense, but if variational inference gives you a posterior that's systematically overconfident, your predictions are miscalibrated and Thompson sampling breaks.

## The Boring Models Won

"Deep Bayesian Bandits Showdown" (Riquelme, Tucker, & Snoek, ICLR 2018) benchmarked a dozen methods for combining neural networks with Thompson sampling across a suite of contextual bandit problems.

The lineup included variational inference (Bayes by Backprop), MC Dropout, SGLD, bootstrapped ensembles — the methods that dominate the uncertainty quantification literature. Also linear baselines, and a hybrid they called NeuralLinear.

The sophisticated Bayesian neural network approaches underperformed. Not because the methods are inherently bad — in supervised learning they work fine — but because online decision-making requires updating the model after every observation, and you can't train to convergence between decisions. Partially-optimized uncertainty estimates led to poor exploration. Bayes by Backprop, Dropout, and SGLD were inconsistent across problems, with performance heavily dependent on hyperparameters and training schedules.

The winners were boring. Exact Bayesian linear regression when the problem was actually linear. And when it wasn't, NeuralLinear: train a neural network to extract features, then fit exact Bayesian linear regression on the final layer.

## Be Bayesian at the Head

This is just the standard embedding-plus-linear-head pattern, made Bayesian at the head. A neural network produces embeddings; instead of learning point-estimate weights via SGD for the final projection, you maintain a normal-inverse-gamma posterior and sample from it for Thompson sampling. The embedding network stays fixed during inference — you're only being Bayesian about the last layer.

This means you're ignoring uncertainty about the embeddings themselves. If you bootstrapped the network training, or did full Bayesian inference over all the weights, you'd get a distribution over embeddings rather than a point estimate. But the paper's results suggest that doing all that stuff doesn't really help you. The methods that tried to capture that uncertainty (variational inference, SGLD, dropout) performed worse than just being Bayesian about the final layer, though, I suspect not because that uncertainty is unimportant, but because the costs of getting it slightly more correct reduce decision-making performance in practice.

One wrinkle: if you retrain the embedding network, the feature space changes and your linear posterior is stale. Your historical data was collected under a different representation — technically an off-policy situation. The paper just uses the direct method: forward-pass stored data through the new network and refit.

## A Point in Favor of My Prior

The engineering simplicity of conjugate models isn't coming at an obvious statistical cost — if anything, the calibrated predictive distributions seem to help. The fancy methods aren't clearly better, and they're definitely harder to run.

I'll keep using conjugate models and feel slightly better about it than before.

---

## References

Riquelme, C., Tucker, G., & Snoek, J. (2018). Deep Bayesian Bandits Showdown: An Empirical Comparison of Bayesian Deep Networks for Thompson Sampling. *International Conference on Learning Representations (ICLR)*.
