---
title: "Analyzing nested experimental designs: A user-friendly resampling method to determine experimental significance"
authors: ["RU Kulkarni", "CL Wang", "CR Bertozzi"]
venue: "PLoS Computational Biology"
year: 2022
date: 2022-05-02
draft: false
tags: ["computational biology", "biomedical research", "statistics", "resampling methods", "hypothesis testing", "python"]

description: "Learn how hierarchical resampling maintains Type I error control in nested experimental designs like neurons within coverslips. Python implementation included with statistical comparisons."
keywords: ["hierarchical resampling", "nested experimental design", "Type I error", "bootstrap", "permutation test", "Python statistics", "biomedical research"]
slug: "hierarchical-resampling-nested-experimental-designs"
toc: true
images: ["/images/hierarchical-resampling-preview.png"] 
categories: ["Statistical Methods", "Publications"]
series: ["Computational Biology"]
featured: true
lastmod: 2025-05-24

# Social/Academic metadata
doi: "10.1371/journal.pcbi.1010061"
publication_type: "journal"
academic_field: "Computational Biology"

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

summary: |
  Hierarchical resampling is a powerful statistical method for analyzing arbitrarily nested experimental designs. This approach combines bootstrap resampling and permutation to control Type I error rates while preserving utilizing
  all available information.

links:
  - text: "Paper"
    url: "https://journals.plos.org/ploscompbiol/article?id=10.1371/journal.pcbi.1010061"
  - text: "Code" 
    url: "https://github.com/rishi-kulkarni/hierarch"
  - text: "DOI"
    url: "https://doi.org/10.1371/journal.pcbi.1010061"
citation: "Kulkarni, R. U., Wang, C. L., & Bertozzi, C. R. (2022). Analyzing nested experimental designs: A user-friendly resampling method to determine experimental significance. PLoS computational biology, 18(5), e1010061."
---