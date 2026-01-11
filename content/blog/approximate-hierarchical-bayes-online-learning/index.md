---
title: "Approximate Hierarchical Bayes for Online Decision-Making"
date: 2026-01-10T00:00:00Z
lastmod: 2026-01-10T00:00:00Z
authors: ["Rishi Kulkarni"]
description: "A practical guide to building scalable Thompson sampling systems using Random Fourier Features and hierarchical priors for contextual bandits."
abstract: "Full Gaussian Process models are ideal for continuous-armed bandits but don't scale. This post walks through a series of principled approximations—Random Fourier Features, conjugate linear regression, hierarchical feature encoding, and Kalman-style forgetting—that preserve uncertainty quantification for Thompson sampling while enabling real-time decisions at scale."
tags: ["statistical-methods", "bayesian-statistics", "machine-learning", "decision-theory"]
keywords: ["Thompson sampling", "Gaussian processes", "Random Fourier Features", "contextual bandits", "hierarchical Bayes", "Kalman filter", "online learning", "exploration-exploitation", "partial pooling", "Bayesian linear regression", "multi-armed bandits", "pricing optimization", "decision making under uncertainty"]
math: true
toc: true
---

Suppose you're choosing a continuous value $x$ and observing a noisy reward $y$. The reward depends on $x$ through some unknown function $f(x)$, and you're making decisions repeatedly—learning as you go.

## The shape of the problem

This is a surprisingly common situation:

- **Price-setting**: You post a price, customers either buy or don't. What price maximizes expected gross profit (margin × probability of selling your whole inventory)?
- **Ad bidding**: You bid in auctions. Higher bids win more often but cost more. What bid wins profitably?
- **Clinical dosing**: Higher doses are more effective but have more side effects. What dose balances the two?
- **Resource allocation**: Provision too little and you can't serve demand; provision too much and you waste money.

The common thread: you're picking a continuous action, the world responds stochastically according to some curve you don't know, and you need to learn while doing.

If you knew $f(x)$, this would be optimization. But you don't—you have to learn it from the very decisions you're making. Get it wrong early and you might converge on a suboptimal action. Explore too aggressively and you pay opportunity costs. The literature calls this the exploration-exploitation tradeoff, and there's a vast theory about how to manage it.

But there's more structure here that the basic framing misses.

### Actually, many related curves

In most real applications, you don't have *one* curve—you have *many* related curves.

Take pricing. You're not setting a single price for a single product. You have prices for different customer segments, different regions, different time periods, different products. Each segment has its own response curve. And crucially: these curves are related. The price sensitivity of customers in Boston probably tells you *something* about customers in Waltham. The response curve for Product A tells you *something* about Product B when both products are in the same category.

Some of these contexts have lots of data. Some have almost none. A new product, a new market, a long-tail customer segment—these might have ten observations where established segments have ten thousand.

If you treat each context independently, the data-poor ones will be wildly unstable. But if you pool everything together, you lose the real variation across contexts. What you want is *partial pooling*: let data-poor contexts borrow strength from data-rich ones, while allowing data-rich contexts to express their genuine differences.

This is the domain of hierarchical models, and it's what makes the problem interesting, statistically speaking.

### Aside: this is a Lipschitz bandit

Let me situate this in the theoretical literature for a moment, because it clarifies why the problem is hard and why some obvious approaches don't work.

At its core, this is a *Lipschitz bandit*. The assumption that makes continuous-armed bandits tractable is Lipschitz continuity: nearby values of $x$ have similar expected rewards. Formally, $|f(x) - f(x')| \leq L|x - x'|$ for some constant $L$.

This smoothness is load-bearing. Without it, every point in the action space is independent—observing $f(x)$ tells you nothing about $f(x')$ for any $x' \neq x$, and you'd need infinite data to learn anything. With Lipschitz continuity, observations generalize to nearby points.

The classic approach to Lipschitz bandits is *zooming* algorithms, introduced by Kleinberg, Slivkins, and Upfal[^1]. The idea is to adaptively discretize the action space: start coarse, and refine the discretization in regions where it matters. You don't need fine resolution everywhere—just in the parts of the action space that might be optimal.

This is elegant, and the regret bounds are tight. But it doesn't quite match our problem.

### Actually, it's worse: contextual + anytime + nonstationary

The real problem is a *contextual anytime nonstationary Lipschitz bandit*. This is the most realistic version of the problem and the least tractable.

**Contextual**: You have many related curves $f_c(x)$ for different contexts $c$. The zooming approach doesn't have a clean analog here. You'd want to zoom in on different regions of $x$ for different contexts—context A might need fine resolution around $x = 10$; context B around $x = 50$. Managing per-context discretizations is a mess. The zooming dimension, which governs regret bounds, interacts badly with context dimensionality.

**Anytime**: You don't know the horizon $T$. This matters more than it might seem. Most bandit algorithms need $T$ to set exploration parameters—UCB confidence widths, exploration schedules, etc. But in production, how long will this system run? Indefinitely. There's no horizon.

The standard fix is the *doubling trick*: run your algorithm for $T = 1$, then $T = 2$, then $T = 4$, resetting at each epoch boundary. This gives valid anytime regret bounds (with log factors). But:

1. **You throw away all data at each epoch.** After 1000 observations, you restart with nothing. All that carefully-explored knowledge? Gone. Theoretically this costs log factors; practically, it's brutal.

2. **We're not even in the problem class it addresses.** The doubling trick gives worst-case guarantees for stationary, non-contextual bandits. We have contextual + nonstationary. The guarantees don't apply; the data-throwing-away still hurts.

**Nonstationary**: The world drifts. $f(x)$ today isn't $f(x)$ six months ago. Seasonality, competitor behavior, macroeconomic conditions—the response curve you learned last year might be actively misleading now. Old data isn't just less useful; it can be harmful.

What you actually want is an algorithm that naturally explores less as uncertainty decreases, has no horizon parameter, doesn't throw away data at epoch boundaries, handles nonstationarity gracefully (recent data matters more), and works across contexts without per-context discretization schemes.

### Aside: separating policy from model

Before jumping to a solution, it's useful to think of bandit problems in two pieces:

1. **Model**: What do you believe about $f(x)$? This includes point estimates, uncertainty, and how beliefs update with data.
2. **Policy**: Given your beliefs, how do you choose $x$?

These are conceptually separate, but not independent. The policy you want to run *constrains* what the model needs to provide:

- **Epsilon-greedy**: Model just needs point estimates. Pick the best estimate with probability $1 - \epsilon$, explore uniformly otherwise.
- **UCB (Upper Confidence Bound)**: Model needs point estimates plus confidence intervals. Pick the action with the highest upper bound.
- **Thompson sampling**: Model needs to be *samplable*. Draw a function from the posterior, optimize it, act.

Look back at our desiderata. We wanted exploration that decreases as uncertainty decreases, with no horizon parameter. Epsilon-greedy doesn't do this—it explores at a fixed rate forever. UCB needs confidence intervals calibrated to a horizon. Thompson sampling is different: exploration emerges from the posterior itself. High uncertainty means high variance in your samples, which means you naturally try different things. As uncertainty shrinks, samples concentrate, and you exploit. No schedule to tune.

Thompson sampling dates to Thompson (1933)[^2], but its theoretical properties weren't understood until recently—Russo et al. (2018)[^3] is the modern reference. The key insight is that you're not adding noise (epsilon-greedy) or inflating estimates (UCB). You're sampling from what you believe and acting as if that sample were true.

This has a requirement: you need a model that's (a) probabilistic, (b) captures uncertainty in a calibrated way, and (c) can be sampled from efficiently. Which brings us to Bayesian models.

## Why Bayesian at all?

The bandit loop—act, observe, update, act—*feels* Bayesian. You have beliefs. You do something. The world responds. You revise your beliefs. This is the Bayesian update cycle with consequences attached.

And the formalism delivers on the intuition:

**Priors as regularization**: When data is sparse, Bayesian priors give you shrinkage toward sensible defaults. This isn't magic; it's regularization with a probabilistic interpretation. A prior that says "extreme values are unlikely" is doing the same work as L2 regularization. This equivalence makes some Bayesians uncomfortable—Gelman calls it the "Bayesian cringe"[^4]—but it's fine. The Bayesian framing makes the assumption explicit and lets you reason about it.

**Posterior uncertainty for exploration**: Thompson sampling needs uncertainty quantification. Frequentist confidence intervals are one option, but they're often approximations (asymptotic normality) or computationally expensive (bootstrap). Bayesian posteriors give you uncertainty for free—it's just the width of your belief distribution.

**Hierarchical priors for partial pooling**: This is the big one. A hierarchical prior says: the parameters for context A and context B are drawn from a shared distribution. Data-poor contexts get pulled toward the population; data-rich contexts express their individuality. This is exactly the partial pooling we wanted for the multi-context case.

The theoretical guarantees are good too. For bandits with appropriate priors, Thompson sampling achieves regret bounds that match or nearly match the information-theoretic optimum[^3].

## The platonic ideal

Given everything above, what would the ideal model look like?

A Gaussian process (GP) is a natural candidate. GPs define distributions over functions—exactly what we need. See Rasmussen and Williams (2006)[^5] for the canonical treatment.

**Continuous action space**: A GP is a distribution over functions $f(x)$. It's nonparametric—you don't assume a functional form like "linear" or "quadratic." Instead, you specify a kernel (covariance function) that encodes smoothness assumptions. The RBF (squared exponential) kernel gives you infinitely differentiable functions. The Matérn kernel lets you tune the smoothness. Lipschitz continuity comes naturally from the kernel choice; the smoothness is built into the prior.

**Uncertainty for exploration**: The GP posterior gives you a mean function (your best estimate) and a variance function (your uncertainty). High posterior variance where you haven't observed; low variance where you have. This is exactly what Thompson sampling needs. The exploration schedule falls out of the model—no hyperparameter to tune.

**Hierarchical structure**: In principle, a hierarchical GP gives you per-context curves. Each context $c$ has its own function $f_c(x)$. Contexts share hyperparameters (e.g., the kernel bandwidth), and their priors can be correlated. Data-poor contexts shrink toward the population mean function; data-rich contexts individuate. The machinery exists—MCMC over shared hyperparameters—but this isn't common in practice.

**Nonstationarity**: GPs handle observation weighting naturally. Give older observations higher noise variance, and they get downweighted in the posterior. This fits into standard GP inference with no special machinery—it's just a heteroskedastic noise model.

**Thompson sampling**: Sample a function from the posterior, find its optimum, act. The GP posterior is analytically tractable (given fixed hyperparameters), so sampling is well-defined. Srinivas et al. (2010)[^6] analyze a related algorithm (GP-UCB) and establish sublinear regret bounds.

This sounds great. All we're really missing is online learning. Why don't people just use it?

### Aside: do you even need online learning?

For many "online learning" problems, you don't actually need online updates. You can batch and retrain periodically—daily, hourly, whatever fits your problem.

Consider: the most capable models in the world right now—large language models—are batch trained. Train once, deploy, maybe retrain quarterly. No online updates. If that works for problems as complex as language, maybe the online framing is sometimes a false constraint.

But let's assume you really do need efficiency at scale. What goes wrong with the ideal GP?

## It ain't so simple

The issues are statistical first, then computational. The statistical limitations cause the computational ones.

### Statistical limitations

**No sufficient statistics.** GPs have no compression. You can't summarize what you've learned about $f$ in a fixed-size object that's independent of how much data you've seen.

Contrast with Bayesian linear regression. If $f(x) = \mathbf{w}^T \phi(x)$ for some feature map $\phi$, the posterior over $\mathbf{w}$ is Gaussian. The sufficient statistics are the precision matrix and the weighted sum of observations—fixed-size, regardless of $n$. Once you update the posterior, you can discard the observation.

GPs don't have this. The posterior at any point depends on all observations through the Gram matrix. You must store everything.

**No closed-form posterior for hierarchical structure.** The above is for single-level GPs. A single GP with fixed hyperparameters has a closed-form posterior—it's just Gaussian conditioning. But we wanted hierarchical structure, with shared hyperparameters across contexts. If we did that, we'd also lose closed-form posteriors. The marginal likelihood for hyperparameters involves all the data. You need MCMC or variational inference.

### Computational consequences

**Memory blows up.** No sufficient statistics means you keep all observations. Hierarchical means thousands of contexts, each accumulating data. At minimum you need $O(n)$ storage for observations, and $O(n^2)$ if you store covariance matrices.

**Training is slow.** No closed-form posterior means MCMC or optimization every time you retrain. This isn't fast matrix algebra; it's iterative procedures that may not even converge quickly. And you retrain regularly, because nonstationarity means the model drifts.

**Inference is slow.** GP posterior evaluation involves solving linear systems with the Gram matrix—$O(n^3)$ in general. And for Thompson sampling, you don't just need the posterior at one point. You need to sample functions and optimize them. Drawing samples that preserve the correlation structure of the posterior requires $O(n^3)$ operations. And this happens at decision time, in real time, for every decision.

These constraints interact. You can't just "fix the compute"—the lack of sufficient statistics is fundamental. Sparse GP approximations help with the $O(n^3)$, but don't give you compression to a fixed-size representation. You still accumulate observations without bound.

## The approximations (and what each costs you)

We need to approximate. The goal is to find approximations that break the constraints while preserving the properties we care about: uncertainty quantification, hierarchical structure, and tractable Thompson sampling.

### Random Fourier Features ("random kitchen sinks")

This is the key approximation. Random Fourier Features (RFF), introduced by Rahimi and Recht (2007)[^7], let you approximate a GP with a finite-dimensional linear model.

**Bochner's theorem** (standard harmonic analysis—see e.g., Rudin[^8]) states that any continuous shift-invariant positive-definite kernel is the Fourier transform of a finite positive measure. For the RBF kernel with bandwidth parameter $\gamma$:

$$k(x - x') = \exp(-\gamma \|x - x'\|^2) = \int e^{i\omega^T(x - x')} p(\omega) \, d\omega$$

where $p(\omega)$ is a Gaussian with variance proportional to $\gamma$. The kernel is an *expectation* over random frequencies.

If something is an expectation, we can Monte Carlo approximate it. Sample $D$ frequencies $\omega_1, \ldots, \omega_D$ from $p(\omega)$, and define features:

$$\phi(x) = \sqrt{\frac{1}{D}} \left[ \cos(\omega_1^T x), \sin(\omega_1^T x), \ldots, \cos(\omega_D^T x), \sin(\omega_D^T x) \right]$$

Then $\phi(x)^T \phi(x')$ is an unbiased estimator of $k(x, x')$ with variance $O(1/D)$.

**What we gain: sufficient statistics return.** A GP in this feature space is just Bayesian linear regression: $f(x) = \mathbf{w}^T \phi(x)$. The posterior is over the $D$-dimensional weight vector $\mathbf{w}$, not the $n$ function values. Model size is $O(D^2)$, independent of $n$. The key constraint from the previous section is broken—we have compression again. Observations can be discarded after updating the posterior.

**What we lose: infinite flexibility.** The true GP lives in an infinite-dimensional reproducing kernel Hilbert space (RKHS). We're projecting onto a $D$-dimensional random subspace. If the true function has structure that happens to be orthogonal to our random features, we'll miss it.

Approximation error depends on:
- $D$: more features means better approximation
- Spectral decay of the true function: smoother functions (in the kernel's sense) are easier to approximate
- How well the chosen kernel matches reality

But here's a reframing: limiting $D$ provides us with implicit regularization. Finite $D$ prevents the model from fitting arbitrarily wiggly functions. It's similar in spirit to early stopping or limiting the number of basis functions in spline regression. If the true function is "simple" in the kernel's sense, the random projection preserves what matters and throws away what would lead to overfitting.

We do get a real problem, though: The bandwidth is fixed. The kernel bandwidth $\gamma$ controls smoothness. A full GP learns $\gamma$ from data via marginal likelihood optimization. With RFF, $\gamma$ is chosen upfront—it's baked into the random features when you sample them.

Wrong $\gamma$ means wrong smoothness assumptions, which means wrong uncertainty estimates. Too small $\gamma$ (wide kernel): you oversmooth and miss real structure. Too large $\gamma$ (narrow kernel): you undersmooth and fit noise.

You're substituting domain knowledge for data-driven learning. If you know your domain well—if you have historical data or subject matter expertise about the smoothness of response curves—this is fine. If not, you're guessing.

**And now we get conjugacy for free.** RFF turns the GP into Bayesian linear regression. Bayesian linear regression with Gaussian likelihood is conjugate—the posterior is analytically tractable.

With a Normal-Inverse-Gamma prior on weights and noise variance:
- Prior: $\mathbf{w} \sim \mathcal{N}(\mathbf{0}, \lambda^{-1} \mathbf{I})$, $\sigma^2 \sim \text{Inv-Gamma}(\alpha, \beta)$
- Posterior after $n$ observations: still Normal-Inverse-Gamma

The update formulas are just matrix algebra:
- Update precision: $\mathbf{\Lambda}_{\text{new}} = \mathbf{\Lambda}_{\text{old}} + \phi(x)\phi(x)^T$
- Update mean: weighted combination of prior and data

This is what "online learning" looks like when you have sufficient statistics. No MCMC, no optimization, no re-fitting. Process observations one at a time, update the posterior, discard the observation.

**Computational complexity:**
- $O(D^2)$ per observation (matrix outer product)
- $O(D^3)$ for sampling (Cholesky decomposition)
- Both depend on $D$, not $n$

(When we add hierarchical structure, these become sparse operations—more on that below.)

This navigates many of the constraints associated with Gaussian processes. We've traded infinite flexibility (which we can't afford computationally and might lead to overfitting anyway) for a fixed-size model with closed-form updates.

### The poor man's hierarchical model

We've handled the GP approximation. What about hierarchical structure?

True hierarchical GPs have shared hyperparameters and correlated priors across contexts. We've given that up—RFF gives us linear regression, not a GP. But we still want partial pooling: data-poor contexts should borrow from data-rich ones.

The solution is to encode hierarchy in the feature representation itself.

**How it works.** Create intercept features at each level of your hierarchy:
- Global intercept (shared by everyone)
- State-level intercept (shared within state)
- City-level intercept (shared within city)
- Context-specific intercept

Also create RFF features at each level. It's not just intercepts that should pool—curve *shape* can vary across the hierarchy too. Maybe states have different response curves, but cities within a state share that state's curve with small perturbations.

The full feature vector for a context might look like:

$$\phi_{\text{full}}(x) = [\underbrace{1}_{\text{global}}, \underbrace{\mathbf{1}_{\text{state}}}_{\text{state intercept}}, \underbrace{\phi(x)}_{\text{global RFF}}, \underbrace{\phi(x) \otimes \mathbf{1}_{\text{state}}}_{\text{state RFF}}, \ldots]$$

Put a regularizing prior on all coefficients (e.g., $\mathbf{w} \sim \mathcal{N}(\mathbf{0}, \lambda^{-1}\mathbf{I})$). This shrinks coefficients toward zero.

Lower levels of the hierarchy (more specific) have sparser data. Fewer observations mean less signal to overcome the prior, so those coefficients get shrunk more. The prediction for a data-poor context is dominated by higher-level features (which have more data and less shrinkage). As data accumulates for a specific context, its context-specific coefficients can grow and override the higher-level defaults.

**What this gets us:**
- Warm starts: a new context immediately inherits global/state/city behavior
- Partial pooling: as context-specific data accumulates, the context can deviate
- Computational tractability: the total feature dimension is large—potentially hundreds of thousands—because it's the product of the RFF dimension and the number of groups at each level. But any single observation only activates features along its path through the hierarchy: global, its state, its city, its context. The feature vector is mostly zeros, so updates are sparse outer products. Complexity scales with active features per observation (hundreds), not total dimension.

**The problem: uncertainty at higher levels is wrong.** This is a "poor man's" hierarchical model for a reason.

We're treating observations within a group as independent. They're not—they share systematic effects from higher levels. This is *pseudoreplication*—a term from experimental design that describes exactly this error[^11]. In econometrics, the same problem motivates *cluster-robust standard errors*[^12] [^13]: when observations are clustered (students within schools, patients within hospitals, purchases within customers), treating them as independent inflates your effective sample size and deflates your standard errors.

The intuition is straightforward. If I observe 1000 customers in California, that's not 1000 independent observations of the global effect. It's 1000 observations that share California-specific systematic error. The variance of my estimate of the California effect scales as $1/n_{\text{CA}}$. But the variance of my estimate of the global effect—if I'm averaging across states—should scale as $1/n_{\text{states}}$, not $1/n_{\text{total}}$. Moulton (1990)[^14] quantifies this: the ratio of the naive variance to the correct variance can be enormous when cluster sizes are large and intra-cluster correlation is high.

The result: we underestimate uncertainty at higher levels of the hierarchy. Our posterior is too narrow. We're more confident than we should be.

**The intercepts don't matter much.** For our application, this underestimation is less damaging than it might seem—at least for intercepts.

The action space (choosing $x$) doesn't vary the intercept. Intercepts shift the curve up or down; actions explore the *shape*. Overconfidence about where the curve sits doesn't translate directly to overconfidence about how it responds to actions.

**But the random effects do suffer.** The RFF features at higher levels capture shared curve shape. These *do* affect how reward varies with action. And they have the same underestimated uncertainty problem.

If I'm overconfident about the state-level response curve, I'm overconfident about which $x$ is optimal for any context in that state. Thompson sampling samples from my posterior. If my posterior is too narrow at higher levels, my samples don't vary enough. I under-explore.

This is a real problem, and we need something to counteract it.

### Yet another advantage of linear regression: Kalman filtering

RFF turned our GP into Bayesian linear regression. Bayesian linear regression has closed-form updates. But there's more structure we can exploit.

The linear-Gaussian setting is exactly the setup for Kalman filtering—a well-studied framework for tracking parameters that evolve over time.

**The Kalman filter interpretation.** Suppose parameters evolve according to:
$$\mathbf{w}_t = \mathbf{w}_{t-1} + \boldsymbol{\epsilon}, \quad \boldsymbol{\epsilon} \sim \mathcal{N}(\mathbf{0}, \mathbf{Q})$$

This is a state-space model. The Kalman filter gives the optimal (minimum variance) estimator. It alternates two steps:

1. **Predict**: Before observing new data, parameters might have changed. Uncertainty *grows*.
   $$\mathbf{\Sigma}_{t|t-1} = \mathbf{\Sigma}_{t-1|t-1} + \mathbf{Q}$$

2. **Update**: Incorporate new observation. Uncertainty *shrinks*.
   $$\mathbf{\Sigma}_{t|t} = \left(\mathbf{\Sigma}_{t|t-1}^{-1} + \phi(x_t)\phi(x_t)^T / \sigma^2\right)^{-1}$$

If $\mathbf{Q} = (1 - \alpha)\mathbf{\Sigma}$ for some decay rate $\alpha$, the predict step becomes:
$$\mathbf{\Lambda}_{t|t-1} = \alpha \mathbf{\Lambda}_{t-1|t-1}$$

This is exponential forgetting. Old information fades; precision decays over time. But it's derived from a generative model about how the world changes—not bolted on as a heuristic.

**What this gives us:**
- Nonstationarity handling grounded in state-space models
- Principled uncertainty re-inflation over time
- Anytime behavior: no horizon parameter, no epoch resets

**Connection to the under-exploration problem.** We just established that our poor man's hierarchy underestimates uncertainty at higher levels. The Kalman predict step continuously re-inflates uncertainty. Does this fix the problem?

Not really—but it helps. The decay re-inflates uncertainty *uniformly* across all parameters, not targeted at the higher-level effects where underestimation is worst. We're not correcting the structure of the error; we're just preventing it from compounding indefinitely. Without decay, overconfidence would lock in and we'd stop exploring. With decay, we at least keep revisiting our beliefs. It's a crude mitigation, not a fix—but crude mitigations that prevent you from getting stuck are often worth having.

**Connection to the anytime problem.** We wanted an algorithm with no horizon parameter. The decay factor provides this. As uncertainty re-inflates, exploration continues.

Contrast with the doubling trick: there, you throw away all data at epoch boundaries. Here, old data fades *gracefully*. There's no discontinuity, no sharp transition where you suddenly forget everything. The forgetting rate $\alpha$ controls how much weight old data gets—but it's a smooth decay, not a hard reset.

In a sense, forgetting *is* the exploration schedule. You don't need to tune how much to explore at different horizons, because the posterior naturally gets less certain over time. Exploration falls out of the uncertainty.

**Trade-offs:**
- The decay rate $\alpha$ is a hyperparameter, not learned from data
- It's uniform across all parameters—maybe higher-level effects should decay differently?
- If the world is actually stationary, you're paying an efficiency cost by forgetting relevant data

But robustness to nonstationarity is usually worth it. In practice, I've never regretted adding decay. I've regretted *not* adding it.

## The MAP

Let me step back and summarize what we've done.

**Started with the ideal**: a hierarchical Gaussian process with Thompson sampling. It addresses the full problem—continuous actions, uncertainty for exploration, hierarchical structure, nonstationarity, contextual bandits.

**Identified statistical limitations**: GPs have no sufficient statistics (you can't compress what you've learned), and hierarchical GPs have no closed-form posterior (you need iterative fitting).

**Followed those to their computational consequences**: memory blows up, training is slow (MCMC/optimization), and inference is slow ($O(n^3)$ at decision time).

**Made approximations**, each grounded in well-established techniques:
- Random Fourier Features: kernel approximation via Bochner's theorem[^7]
- Conjugate linear regression: textbook Bayesian inference
- Hierarchical features: standard mixed-effects model intuition[^9]
- Exponential decay: Kalman filtering[^10]

**Ended up with something tractable** that addresses the actual shape of the problem:
- Contextual: hierarchical features with partial pooling
- Continuous actions: RFF captures nonlinear response curves
- Anytime: no horizon parameter, exploration via posterior uncertainty
- Nonstationary: Kalman-style forgetting

### The same Faustian bargain again

Large-scale machine learning is full of similar trade-offs. You start with the ideal model, identify why it doesn't scale, and choose approximations that preserve what matters for your problem.

- **Diagonal covariance in recommender systems**: Collaborative filtering with full covariance over millions of items is impossible. Factorized models (matrix factorization, factorization machines) keep what matters—low-rank structure—and throw away the full covariance.
- **Factorized posteriors in variational inference**: The true posterior might have complex dependencies. Mean-field approximations assume independence, but often that's enough for prediction.
- **Mini-batch everything**: Gradient descent with the full dataset is exact. Mini-batch is an approximation. But the approximation is good enough and enables scale.

As long as you understand the structure of your problem, identify which properties are load-bearing, and choose approximations that preserve those properties - approximations can be powerful tools.

### In rare form, reality is convenient here

I want to end with a point about where this kind of approximation sits in practice.

Businesses rarely start with a complex algorithm on day one. By the time you're building something sophisticated—a hierarchical Bayesian bandit system—you have historical data, domain expertise, and intuition about what matters. You can encode that knowledge in your modeling choices:
- Reasonable kernel bandwidths (informed by historical response curves)
- Sensible hierarchy structure (matching how your business is organized)
- Appropriate decay rates (how fast does the market change?)

This lets you simplify significantly while staying robust to the things you rightly fear. The approximations aren't flying blind—they're informed by experience.

The RFF features have a fixed bandwidth, which sounds limiting. But if I've been running pricing for a year, I have a pretty good sense of how price-sensitive customers are. Encoding that as a prior bandwidth isn't cheating—it's using what I know.

The poor man's hierarchy underestimates uncertainty at higher levels. But I know that, and the Kalman decay counteracts it—not completely, but to some extent. And honestly, for most applications, the lower levels of the hierarchy are where the action is. Getting the city-level curve right matters more than perfect uncertainty quantification at the global level.

In practice, this approach has served me well. The approximations compose cleanly—each addresses a different limitation. The computational costs are low: $O(D^2)$ per observation, $O(D^3)$ per sample, both with $D$ in the hundreds of thousands to low millions. Training is a sparse matrix update. Inference is a sparse matrix solve. Real-time decisions at scale are feasible.

When you know your domain, substituting that knowledge for data-driven learning is often a good trade. The approximations aren't defects—they're where your expertise enters the model.

[^1]: Kleinberg, R., Slivkins, A., & Upfal, E. (2019). Bandits and experts in metric spaces. *Journal of the ACM*, 66(4), 1-77. (Earlier conference version: STOC 2008)

[^2]: Thompson, W. R. (1933). On the likelihood that one unknown probability exceeds another in view of the evidence of two samples. *Biometrika*, 25(3/4), 285-294.

[^3]: Russo, D. J., Van Roy, B., Kazerouni, A., Osband, I., & Wen, Z. (2018). A tutorial on Thompson sampling. *Foundations and Trends in Machine Learning*, 11(1), 1-96.

[^4]: Gelman, A. (2021). The Bayesian Cringe. *Statistical Modeling, Causal Inference, and Social Science* (blog). https://statmodeling.stat.columbia.edu/2021/09/15/the-bayesian-cringe/

[^5]: Rasmussen, C. E., & Williams, C. K. I. (2006). *Gaussian Processes for Machine Learning*. MIT Press.

[^6]: Srinivas, N., Krause, A., Kakade, S. M., & Seeger, M. W. (2010). Gaussian process optimization in the bandit setting: No regret and experimental design. *Proceedings of the 27th International Conference on Machine Learning (ICML)*.

[^7]: Rahimi, A., & Recht, B. (2007). Random features for large-scale kernel machines. *Advances in Neural Information Processing Systems 20 (NeurIPS)*.

[^8]: Rudin, W. (1962). *Fourier Analysis on Groups*. Wiley.

[^9]: Gelman, A., & Hill, J. (2007). *Data Analysis Using Regression and Multilevel/Hierarchical Models*. Cambridge University Press.

[^10]: Kalman, R. E. (1960). A new approach to linear filtering and prediction problems. *Journal of Basic Engineering*, 82(1), 35-45.

[^11]: Kulkarni, R. U., Wang, C. L., & Bertozzi, C. R. (2022). Analyzing nested experimental designs—A user-friendly resampling method to determine experimental significance. *PLOS Computational Biology*, 18(5), e1010061.

[^12]: Liang, K.-Y., & Zeger, S. L. (1986). Longitudinal data analysis using generalized linear models. *Biometrika*, 73(1), 13-22.

[^13]: Cameron, A. C., & Miller, D. L. (2015). A practitioner's guide to cluster-robust inference. *Journal of Human Resources*, 50(2), 317-372.

[^14]: Moulton, B. R. (1990). An illustration of a pitfall in estimating the effects of aggregate variables on micro units. *Review of Economics and Statistics*, 72(2), 334-338.
