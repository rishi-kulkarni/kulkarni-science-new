---
title: "Analyzing nested experimental designs: A user-friendly resampling method to determine experimental significance"
authors: ["RU Kulkarni", "CL Wang", "CR Bertozzi"]
venue: "PLoS Computational Biology"
year: 2022
date: 2022-05-02
draft: false
tags: ["Computational Biology", "Hierarchical Models", "Python"]
abstract: |
  While hierarchical experimental designs are near-ubiquitous in
  neuroscience and biomedical research, researchers often do not
  take the structure of their datasets into account while performing
  statistical hypothesis tests. We present Hierarch, a Python package for
  analyzing nested experimental designs. Using a combination of permutation
  resampling and bootstrap aggregation, Hierarch can be used to
  perform hypothesis tests that maintain nominal Type I error rates
  and generate confidence intervals that maintain the nominal
  coverage probability without making distributional assumptions
  about the dataset of interest.
links:
  - text: "Paper"
    url: "https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1010061"
  - text: "Code" # If applicable
    url: "https://github.com/rishi-kulkarni/hierarch" # Example link
citation: "" # Optional: If you have a pre-formatted BibTeX or similar string for this specific paper
---

<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
{{< load-js "hierarchical-utils.js" >}}

## The Experiment That Started It All

We were studying how microglia affect neuronal networks using a fairly standard imaging experiment. The setup was simple: 3 coverslips per condition, about 20 neurons measured per coverslip. Our question: Does LPS activation significantly increase PNA signal?

Seems straightforward, right? The analysis turned out to be trickier than expected.

## Option 1: Pool All the Neurons

Our first instinct was to treat all ~60 neurons per condition as independent observations. Big sample size, small p-values - what's not to like?

But here's the problem: neurons on the same coverslip share systematic effects. They experience the same temperature fluctuations, the same batch of media, the same subtle variations in staining protocol. We're not really measuring 60 independent neurons - we're measuring 3 coverslips with different levels of precision.

This approach treats systematic variation as if it were random noise, which inflates Type I error rates and leads to results that don't replicate.

<div class="plot-container" style="margin: 20px 0;">
    <canvas id="type-i-error-plot"></canvas>
</div>

<script>

    initializeTypeIErrorSimulation();

</script>

## Option 2: Average Within Coverslips

OK, so let's be more careful. Average the 20 neurons per coverslip and analyze the 3 coverslip means. This respects the experimental structure, but something bothered us:

**Why doesn't imaging more neurons per coverslip increase our statistical power?**

More neurons should give us better estimates of each coverslip mean, which should make our test more sensitive. And it does help - but not nearly as much as we'd expect.

<div class="plot-container" style="margin: 20px 0;">
    <canvas id="power-simulation"></canvas>
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

The simulation shows the issue: when we take averages, we lose the uncertainty information that comes from knowing how variable the measurements were within each coverslip.

## Option 3: Mixed Models

Linear mixed models seem purpose-built for this problem: neurons nested within coverslips. But with only 3 coverslips per group, these models break down. They try to estimate random effects with almost no data.

Plus, mixed models regularize estimates by shrinking them toward the overall mean. That's useful for prediction, but we want unbiased estimates for hypothesis testing.

## The Solution: Hierarchical Randomization

The key insight is to combine two resampling approaches:

1. **Bootstrap within coverslips** to estimate the uncertainty in each coverslip mean
2. **Permute treatment labels only at the coverslip level** (where we actually assigned treatments)

This uses all the data while respecting the dependencies in our design.

## Why This Worked

Those extra neurons per coverslip *do* increase power - by giving us better estimates of each coverslip's true mean. Bootstrapping captures this benefit instead of discarding it. We only shuffle labels where it makes sense (coverslips, not individual neurons). No assumptions about data distributions. Works fine with just 3 coverslips per group.

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