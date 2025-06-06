---
title: "Use Exact Tests for Nested Experimental Designs"
charts: true
math: true  
simulations: true
date: 2025-05-24T00:00:00Z
lastmod: 2025-05-24T00:00:00Z
authors: ["Rishi Kulkarni"]
description: "Learn how to properly analyze nested experimental designs like neurons-within-coverslips using hierarchical resampling methods. Includes Python implementation and statistical comparisons with traditional approaches."
abstract: "Traditional statistical approaches to nested experimental designs in neuroscience violate fundamental assumptions, leading to inflated Type I error rates and reproducibility issues. Hierarchical resampling offers a principled solution that maintains statistical rigor while utilizing all available information from hierarchical data structures."
summary: "Hierarchical resampling provides exact statistical tests for nested experimental designs by combining bootstrap resampling within experimental units with permutation testing at the randomization level. This approach maintains Type I error control while using all available information, unlike traditional methods that either pool inappropriately or discard useful data."
tags: ["neuroscience-statistics", "experimental-design", "statistical-methods", "type-i-error", "resampling", "python", "biomedical-research", "data-analysis", "reproducibility", "hypothesis-testing"]
keywords: ["neuroscience statistics", "nested experimental design", "hierarchical resampling", "Type I error control", "bootstrap permutation", "coverslip neuron analysis", "biomedical statistics", "experimental design flaws", "statistical significance testing", "Python data science", "research reproducibility", "nested data analysis", "permutation testing", "bootstrap methods",]
images: ["/images/neuroscience-statistics-hierarchical-resampling.jpg"]
categories: ["Data Science", "Neuroscience", "Statistical Methods"]
series: ["Research Methods"]
featured: true
toc: true
canonical: "https://rukulkarni.com/blog/2025/neuroscience-statistics-hierarchical-resampling/"
links:
  - text: "📄 Original Paper (PLoS Comp Bio)"
    url: "https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1010061"
  - text: "🐍 Hierarch Python Package"
    url: "https://github.com/rishi-kulkarni/hierarch"
  - text: "🔗 DOI"
    url: "https://doi.org/10.1371/journal.pcbi.1010061"
---

## A Motivating Example

We were studying how microglia affect neuronal networks using a standard imaging experiment: 3 mice, 3 coverslips per condition, about 20 neurons measured per coverslip. Our question: Does LPS activation significantly increase PNA signal?

The experimental design was straightforward, but choosing the right statistical analysis proved more challenging than anticipated.

## Option 1: Pool All Neurons

A common approach in the literature is to treat all ~60 neurons per condition as independent observations. This maximizes sample size and often yields small p-values.

However, neurons on the same coverslip share systematic effects: temperature fluctuations, media preparation, staining protocol variations. The analysis assumes 60 independent observations when we actually have 3 coverslips measured with different levels of precision.

This approach treats systematic variation as random noise, inflating Type I error rates and contributing to reproducibility issues. As you can see in the simulation below, this inflates Type I error rates significantly, leading to false positives.

<div class="plot-container" style="margin: 20px 0;">
    <canvas id="type-i-error-plot"
            role="img"
            aria-label="Simulation showing Type I error inflation when pooling nested data compared to proper hierarchical analysis methods">
    </canvas>
</div>

<script>

    initializeTypeIErrorSimulation();

</script>

## Option 2: Average Within Coverslips

The summary statistics approach averages the 20 neurons per coverslip and analyzes the 3 coverslip means. This respects the experimental structure and maintains proper Type I error control.

However, this approach discards potentially useful information. When we summarize each coverslip to a single mean, we lose the uncertainty information that comes from knowing how variable the measurements were within each coverslip.

<div class="plot-container" style="margin: 20px 0;">
    <canvas id="power-simulation"
            role="img"
            aria-label="Simulation showing power increase with more neurons per coverslip, but plateauing quickly. This illustrates the limitation of averaging within coverslips."
    ></canvas>
</div>

<script>
document.addEventListener('DOMContentLoaded', function() {
    if (typeof initializePowerSimulation === 'function') {
        initializePowerSimulation();
    } else {
        console.error('initializePowerSimulation not found');
    }
});
</script>

The simulation illustrates the limitation: while imaging more neurons per coverslip does slightly improve power by reducing measurement error, the gains plateau quickly. More fundamentally, we're collapsing rich distributional information into point estimates, potentially sacrificing statistical power. 

So if simple averaging discards useful information, what about more sophisticated approaches? Mixed models seem like the obvious next step.

## Option 3: What About Mixed Models?
Linear mixed models seem purpose-built for hierarchical data like neurons nested within coverslips. They're widely used in biomedical research and explicitly account for multiple levels of variation.

However, mixed models optimize for a different goal than hypothesis testing. Consider the distinction:

* **Prediction**: What PNA signal would we expect from a new coverslip? Here, shrinking extreme estimates toward the population mean improves accuracy.
* **Inference**: What's the true difference in mean PNA signal between LPS and control conditions? Here, shrinkage biases our effect size estimates in ways that depend on the model specification.

Mixed models use partial pooling to regularize estimates - shrinking individual coverslip means toward the overall mean. This regularization reduces prediction error when estimating outcomes for new coverslips, but it changes the bias-variance trade-off for effect size estimation in ways that may not align with our inferential goals.

With only 3 coverslips per group, this problem compounds: mixed models struggle to reliably estimate variance components with so few clusters, and the regularization that improves prediction operates on different assumptions than those needed for unbiased causal inference.

The popularity of mixed models in biomedical research reflects their ability to "handle" hierarchical data, but handling hierarchical structure and optimizing for causal inference are different objectives.

## What We Really Need
We need an approach that:
- Maintains proper Type I error control (unlike pooling)
- Uses all available information (unlike averaging) 
- Optimizes for inference rather than prediction (unlike mixed models)

This leads us to hierarchical resampling.


## The Solution: Hierarchical Resampling

**Hierarchical randomization provides an exact (or approximately exact) test that works for any nested experimental design.** Rather than making distributional assumptions or discarding information, it directly simulates the null hypothesis while respecting the experimental structure.

### The Method

The approach combines two complementary resampling strategies:

1. **Bootstrap within experimental units** (coverslips) to quantify measurement uncertainty from finite sampling of sub-units (neurons)
2. **Permute treatment labels only at the level where randomization occurred** (coverslip level, where we actually assigned treatments)

### Why This Is Approach Works

This is a principled approach that:

- **Respects the experimental design**: We only shuffle labels where randomization actually happened. Since we assigned treatments to coverslips (not individual neurons), we only permute at the coverslip level.

- **Uses all available information**: Instead of collapsing rich distributional data into point estimates, bootstrapping captures the full uncertainty structure from our measurements.

- **Makes no distributional assumptions**: The test statistic distribution comes directly from the data-generating process under the null hypothesis, not from theoretical distributions that may not apply.

- **Provides exact Type I error control**: For any sample size, any distribution, any degree of imbalance - the test maintains nominal error rates because it directly simulates the null hypothesis.

### The Key Insight

Those extra neurons per coverslip *do* increase statistical power - by giving us more precise estimates of each coverslip's true mean. But traditional analyses either:
- Ignore this precision information (averaging approaches)  
- Conflate it with other sources of variation (pooling approaches)
- Optimize for prediction rather than inference (mixed models)

Hierarchical resampling captures this precision benefit while maintaining the proper experimental framework for causal inference.

### Broad Applicability

This framework extends to any nested design:
- Neurons within coverslips within mice
- Students within classrooms within schools  
- Cells within wells within plates
- Measurements within subjects within studies

The principle remains the same: **bootstrap within units, permute between units at the randomization level**.

## Making It Practical

The [Hierarch package](https://github.com/rishi-kulkarni/hierarch) automates all of this:

```python
import hierarch as h
import pandas as pd

# Data organized as: Coverslip, Treatment, Neuron_ID, PNA_Signal
data = pd.read_csv('experiment_data.csv')

# Automatic analysis
result = h.hypothesis_test(data)
print(f"p-value: {result.pvalue}")
```