---
title: "{{ replace .Name "-" " " | title }}"
authors: ["RU Kulkarni"]
venue: ""
year: {{ .Date | time.Format "2006" }}
date: {{ .Date }}
tags: []
abstract: ""
links:
  - text: "Paper"
    url: ""
  - text: "Code"
    url: ""
citation: ""
---