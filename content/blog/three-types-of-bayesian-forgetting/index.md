---
title: "Three Types of Bayesian Forgetting for Online Learning"
date: 2026-04-04T00:00:00Z
lastmod: 2026-04-04T00:00:00Z
authors: ["Rishi Kulkarni"]
description: "How to handle forgetting in Bayesian online regression: exponential decay causes covariance windup, stabilized forgetting adds a prior floor, and directional forgetting via the SIFt algorithm forgets only in directions the data can replenish."
abstract: "Any online learner in a non-stationary environment needs to forget old data. In Bayesian recursive least squares, forgetting means shrinking the precision matrix, and the choice of how to shrink it has real consequences. This post walks through three approaches: exponential forgetting (simple but divergent), stabilized forgetting (safe but isotropic), and directional forgetting via the SIFt algorithm (geometrically principled, borrowed from adaptive control). Each addresses a limitation of the previous one."
summary: "If you're running a Bayesian model in a non-stationary environment, you need to forget old data. The obvious approach – scale the precision matrix by a constant – has a failure mode called covariance windup. This post works through three forgetting rules, ending with one borrowed from adaptive control that dominates the others."
tags: ["statistical methods", "bayesian statistics", "machine learning", "online learning"]
keywords: ["Bayesian forgetting", "recursive least squares", "exponential forgetting", "covariance windup", "covariance divergence", "stabilized forgetting", "Kulhavy Zarrop", "directional forgetting", "SIFt algorithm", "Cao Schwartz", "adaptive control", "non-stationary", "Bayesian non-stationary", "precision matrix", "precision matrix decay", "Thompson sampling", "contextual bandits", "Kalman filter", "Kalman filter forgetting", "online learning"]
math: true
toc: true
---

Any online learner operating in a non-stationary environment eventually needs to forget. I've [argued before](/blog/approximate-hierarchical-bayes-online-learning/) that most real decision problems are non-stationary, that robustness to nonstationarity is usually worth it, and that I've never regretted adding decay but have regretted not adding it. If you accept that premise, forgetting isn't optional. The question is how to do it well.

The problem shows up everywhere: recursive least squares, Kalman filters, adaptive controllers. Old data, collected under conditions that no longer hold, actively misleads the model if given equal weight to recent observations. You need some mechanism to down-weight it.

The Bayesian formulation of this problem is particularly transparent. The posterior precision matrix $\boldsymbol{\Lambda}$ is a concrete object that encodes everything you know about the parameters. High eigenvalues mean high confidence in those directions of parameter space; low eigenvalues mean uncertainty. Forgetting is a concrete operation on this object–shrink the precision, and you become less confident. The question is how to shrink it.

I'll focus on the Bayesian version of the problem here, but the underlying ideas–covariance windup, stabilization, directional decomposition–originated in the adaptive control literature and apply to any system that maintains a recursive estimate of a covariance or precision matrix.

## The update loop

The Bayesian recursive least squares update with forgetting has three steps. First, forget: apply some rule to get a "forgotten" precision $\bar{\boldsymbol{\Lambda}}$ from the current precision $\boldsymbol{\Lambda}$. Then update:

$$\boldsymbol{\Lambda}_n = \bar{\boldsymbol{\Lambda}} + \beta \mathbf{X}^\top \mathbf{W} \mathbf{X}$$

$$\boldsymbol{\eta}_n = \bar{\boldsymbol{\Lambda}} \boldsymbol{\mu}_{\text{old}} + \beta \mathbf{X}^\top \mathbf{W} \mathbf{y}$$

$$\boldsymbol{\mu}_n = \boldsymbol{\Lambda}_n^{-1} \boldsymbol{\eta}_n$$

Here $\beta$ is the noise precision, $\mathbf{W}$ is a diagonal matrix of sample weights, and $\boldsymbol{\mu}$ is the posterior mean recovered by a single Cholesky solve. The information vector $\boldsymbol{\eta}$ is an intermediate; it avoids computing the inverse precision directly.

The rule that maps $\boldsymbol{\Lambda}$ to $\bar{\boldsymbol{\Lambda}}$ is the entire design space. Everything else is fixed by Bayes' rule. The three methods below differ only in this step.

## Exponential forgetting

$$\bar{\boldsymbol{\Lambda}} = \gamma \boldsymbol{\Lambda}$$

This is the default because there's almost nothing to it. A scalar multiply on the precision matrix. It preserves sparsity structure, introduces no additional parameters beyond $\gamma$, and reduces to the standard (no-forgetting) update when $\gamma = 1$. If the precision is stored as a sparse matrix, the cost is $O(\text{nnz})$, linear in the number of nonzero entries.

The failure mode is covariance windup, and it's caused by uneven excitation.

Each decay step scales *every* eigenvalue of the precision by $\gamma$. The subsequent update adds $\beta \mathbf{X}^\top \mathbf{W} \mathbf{X}$ back, but this only replenishes precision in the directions excited by the current batch. If the feature space is high-dimensional and the batch is small (the typical case), most directions receive no new information. Those directions lose a fraction $1 - \gamma$ of their precision on every step and never get it back. Over time, the eigenvalues in the unexcited directions shrink toward zero. The covariance (the inverse of precision) in those directions explodes.

The prior contribution $\alpha \mathbf{I}$ decays along with everything else, so the model eventually loses its regularization too. In the limit the precision matrix becomes numerically singular and the Cholesky factorization fails. This is the Bayesian analog of integrator windup in control theory: the covariance accumulates uncertainty without bound because nothing constrains it from below.

If every direction were uniformly excited–every batch providing information about every parameter–the update step would counteract the decay and the precision would reach a steady state. The problem is specifically that excitation is non-uniform. Some directions are replenished constantly, others rarely or never.

### Aside: the Kalman interpretation

Exponential forgetting has a clean generative interpretation. It's exactly the predict step of a Kalman filter for a random-walk state-space model:

$$\mathbf{w}_t = \mathbf{w}_{t-1} + \boldsymbol{\epsilon}, \quad \boldsymbol{\epsilon} \sim \mathcal{N}(\mathbf{0}, \mathbf{Q})$$

with process noise $\mathbf{Q} = (1 - \gamma) \boldsymbol{\Sigma}$, where $\boldsymbol{\Sigma} = \boldsymbol{\Lambda}^{-1}$ is the current covariance. The predict step inflates the covariance: $\boldsymbol{\Sigma}_{t|t-1} = \boldsymbol{\Sigma}_{t-1} + \mathbf{Q}$. In the precision parameterization, this is equivalent to $\bar{\boldsymbol{\Lambda}} = \gamma \boldsymbol{\Lambda}$. This grounds exponential forgetting in a model of how the world changes: parameters undergo a random walk, and larger $1 - \gamma$ means larger steps.

## Stabilized forgetting

$$\bar{\boldsymbol{\Lambda}} = \gamma \boldsymbol{\Lambda} + (1 - \gamma) \alpha \mathbf{I}$$

Kulhavy and Zarrop (1993)[^1] proposed a direct fix: after scaling the precision by $\gamma$, add back a fraction of the prior. The term $(1 - \gamma) \alpha \mathbf{I}$ is a floor. It guarantees that no eigenvalue of $\bar{\boldsymbol{\Lambda}}$ can fall below $(1 - \gamma) \alpha$, regardless of how many decay steps have occurred or how little data has arrived. Covariance windup is gone.

### Aside: the steady-state argument

Why this particular form? Consider what happens to the prior contribution under repeated application. Let $s_t$ track the prior scalar on the precision diagonal. Under pure exponential forgetting, $s_{t+1} = \gamma s_t$, which converges to zero. Under stabilized forgetting:

$$s_{t+1} = \gamma s_t + (1 - \gamma) \alpha$$

This is a linear recurrence with fixed point $s^* = \alpha$. Starting from any $s_0$, the prior contribution converges to $\alpha$, the initial prior precision. The model can never become less confident than its prior, no matter how aggressively or for how long you decay. The prior represents a genuine belief about the scale of the parameters, and forgetting data shouldn't make you less certain than you were before seeing any data at all.

### Where does $\alpha$ come from?

The floor is pinned to $\alpha$, which raises an obvious question: if you believe your environment is non-stationary, why should the prior precision be fixed in time? The whole point of forgetting is that the world changes. A prior calibrated at deployment might be wrong a month later.

There are two ways to deal with this. Empirical Bayes lets the data tune $\alpha$ via evidence maximization (MacKay's update rules in the conjugate setting). That's a substantial enough topic for a separate post. The other option is to treat $\alpha$ as a regularization parameter rather than a belief about the world–Gelman's "cringing Bayesian"[^4] perspective, where the prior is doing the same work as L2 regularization and you're not particularly attached to its interpretation as a genuine belief. In that framing, $\alpha$ just needs to be large enough to prevent degeneracy, and you don't worry about whether it tracks the true generative process.

### The isotropy problem

The more fundamental limitation of stabilized forgetting is that it's still isotropic. Every direction in parameter space loses the same fraction of precision, then gets the same floor added back. The forgetting is symmetric regardless of whether new data will replenish a given direction.

Consider a contextual bandit with 1000 features, 990 of which are dense user attributes (excited by every observation) and 10 of which are rare event indicators (excited a few times a year). Under stabilized forgetting, the rare-event features lose precision at the same rate as the dense features. The dense features get replenished immediately by the next batch of observations. The rare-event features don't. They sit at the floor, with no new data to push them above it, until the rare event happens again.

Stabilized forgetting makes the model safe. It does not make the model good at tracking change when the structure of change is non-uniform across features.

## Directional forgetting

Covariance windup has been a problem in adaptive control since at least the 1980s. Recursive least squares is the workhorse of adaptive control (identifying plant parameters from input-output data), and non-stationary environments are the norm. Kulhavy and Zarrop's stabilized forgetting came from that world. So did the next idea.

Cao and Schwartz (2000)[^2] asked what seems like an obvious question once you hear it: why forget uniformly when excitation is directional? In adaptive control, the system identifies parameters by applying inputs and observing outputs. At any given time, the inputs excite certain directions in parameter space, the directions along which the data is informative. Other directions receive no information from the current data. Forgetting in unexcited directions discards knowledge that the current data cannot replace.

Their solution is to decompose the precision relative to the information subspace of the current batch. Forget in excited directions, where new data will arrive to replenish the lost precision. Leave unexcited directions untouched.

The forgetting rule is:

$$\bar{\boldsymbol{\Lambda}} = \boldsymbol{\Lambda} - (1 - \gamma) \boldsymbol{\Lambda} \bar{\mathbf{X}}^\top \left(\bar{\mathbf{X}} \boldsymbol{\Lambda} \bar{\mathbf{X}}^\top \right)^{-1} \bar{\mathbf{X}} \boldsymbol{\Lambda}$$

The intuition: the second term is a projection. It identifies how much of the current precision lives in the subspace that the batch excites, and removes a fraction $1 - \gamma$ of it. If a direction in parameter space is orthogonal to the batch, the projection is zero in that direction and the precision is unchanged. If a direction is fully excited by the batch, it gets the same $\gamma$ scaling that exponential forgetting would have applied. Directions in between get a proportional correction.

### The SIFt algorithm

In adaptive control, the original setting for this formula, updates tend to be single observations arriving at a fixed rate from a known plant. In bandits, the situation is messier. Updates are asynchronous, batches are small and variable-sized, and the batch is almost always rank-deficient: $q$ observations can excite at most $q$ directions in an $n$-dimensional parameter space. With high-dimensional sparse features, $q \ll n$ on every step.

Lai and Bernstein (2024)[^3] address this with the SIFt (Selective Information Forgetting) algorithm. The idea is to eigendecompose the batch's Gram matrix, threshold out directions with negligible excitation (eigenvalues below a tolerance $\varepsilon$), and work in the surviving $q$-dimensional subspace. The sufficient statistics $\mathbf{X}^\top \mathbf{X}$ and $\mathbf{X}^\top \mathbf{y}$ are preserved in this subspace, so the forgetting step loses nothing by operating there instead of in the full $n$-dimensional space.

**Proposition 5 (precision retention).** $\bar{\boldsymbol{\Lambda}} \succeq \gamma \boldsymbol{\Lambda}$, meaning $\bar{\boldsymbol{\Lambda}} - \gamma \boldsymbol{\Lambda}$ is positive semidefinite. SIFt always retains at least as much precision as scalar forgetting. (Here $\succeq$ denotes the Loewner order: $A \succeq B$ means $A - B$ is PSD.) When the batch rank $q < n$, SIFt retains strictly more. The inequality is tight only when $q = n$, which almost never happens in practice. With 5 observations and 100,000 features, scalar forgetting shrinks precision in all 100,000 directions. SIFt shrinks it in 5.

**Theorem 3 (eigenvalue bound).** After arbitrarily many forget-update cycles:

$$\lambda_{\min}(\boldsymbol{\Lambda}_k) \geq \min\!\left(\frac{\varepsilon}{1 - \gamma},\; \lambda_{\min}(\boldsymbol{\Lambda}_0)\right)$$

This is a hard floor on the minimum eigenvalue of the precision matrix, and it holds indefinitely. The floor depends on the eigenvalue threshold $\varepsilon$ and the forgetting rate $\gamma$, both user-specified. No artificial prior injection is needed. The floor emerges from the geometry of the directional forgetting itself: as long as the filter_batch threshold $\varepsilon$ is positive, SIFt will not allow the precision to collapse.

Compare this with stabilized forgetting, where the floor is $(1 - \gamma) \alpha$: an explicitly injected prior. Here the floor is $\varepsilon / (1 - \gamma)$: a consequence of only forgetting in directions that receive new information.

### Computational cost

The formula involves a matrix inverse and several matrix products, which looks expensive. The structure of the problem makes it cheaper than it appears.

**Dense case.** The inner Gram matrix $\bar{\mathbf{X}} \boldsymbol{\Lambda} \bar{\mathbf{X}}^\top$ is $q \times q$, where $q$ is the batch rank (at most the batch size, typically single digits). The Cholesky of this small matrix costs $O(q^3)$, negligible. The dominant cost is the rank-$q$ symmetric update to the $n \times n$ precision matrix, implemented as a BLAS-3 `dsyrk` call at $O(n^2 q)$, the same asymptotic cost as the standard RLS update.

**Sparse case.** The correction only touches features that interact with the batch in the sparsity graph of the precision matrix. If the batch activates $k_0$ columns of a sparse design matrix, the linear algebra operates on a $k_0 \times k_0$ dense submatrix extracted from the sparse precision, and the correction is scattered back. For a 100,000-feature sparse model with 10 active features per batch, the inner Cholesky is $10 \times 10$. The sparse path uses pivoted Cholesky (`dpstrf`) rather than eigendecomposition, which handles rank deficiency gracefully and is roughly 20 times faster for the small Gram matrices that arise in practice.

## Directional forgetting as the default

Proposition 5 says that directional forgetting retains at least as much precision as exponential forgetting, always. When the batch is rank-deficient ($q < n$, which is nearly every real update), it retains strictly more. In the edge case where $q = n$ and every direction is excited, they're identical. Directional forgetting is never worse than exponential forgetting and usually better. If you were going to use exponential forgetting, use directional forgetting instead.

The advantage is largest in the situations where exponential forgetting is most dangerous: sparse, high-dimensional feature spaces with heterogeneous excitation. In a contextual bandit where the feature vector is a sparse encoding of user attributes, product categories, and contextual signals, any individual observation activates a small subset of features. Under exponential forgetting, every feature loses precision on every step, and the unexcited ones never recover. Under directional forgetting, only the active features lose precision, and they're immediately replenished by the update.

This is especially relevant for hierarchical feature encodings where global features are excited by every observation but segment-specific and context-specific features are sparse. Exponential forgetting decays precision on a rarely-observed segment at the same rate as the global mean. Directional forgetting leaves the rare segment alone until data for that segment actually arrives.

The remaining question is whether you also need a stabilized floor. Directional forgetting and stabilized forgetting address different problems, and you can combine them. The case where this matters most is online empirical Bayes. If you're using empirical Bayes to tune the prior precision $\alpha$ as a substitute for a full hierarchical model, KZ stabilization is how you keep the evolving prior relevant as EB updates it over time. Without stabilization, the prior that EB is trying to optimize decays away before it can have any effect. With it, EB's updated $\alpha$ is continuously re-injected into the precision floor, so the hierarchical prior actually influences the posterior as intended. I'll discuss this interaction in a separate post.

[^1]: Kulhavy, R. & Zarrop, M. B. (1993). "On a general concept of forgetting." *International Journal of Control*, 58(4), 905-924.

[^2]: Cao, L. & Schwartz, H. M. (2000). "A directional forgetting algorithm based on the decomposition of the information matrix." *Automatica*, 36(11), 1725-1731.

[^3]: Lai, B. & Bernstein, D. S. (2024). "SIFt-RLS: Subspace of Information Forgetting Recursive Least Squares." arXiv:2404.10844. https://arxiv.org/abs/2404.10844

[^4]: Gelman, A. (2021). "The Bayesian Cringe." *Statistical Modeling, Causal Inference, and Social Science* (blog). https://statmodeling.stat.columbia.edu/2021/09/15/the-bayesian-cringe/
