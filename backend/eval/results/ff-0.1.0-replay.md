# Form ingestion eval — prompt ff-0.1.0 (REPLAY: harness check only, not a model result)

- **Date:** 2026-10-30
- **Deployment (model):** n/a (replay)
- **JSON mode:** n/a (replay)
- **Forms evaluated:** 1 (1 scored)
- **Match rule:** label similarity ≥ 0.8, one-to-one
- **Caveat:** The gold set is a SINGLE FICTIONAL form (`sample-isp-intake`, written for the demo, not an official state form). These numbers show the pipeline and harness work end to end; they are NOT a claim about accuracy on real state forms.

| Form | Pages | Field recall | Precision | Type acc. | Option acc. | Required acc. | Valid | Tokens | Tokens/page | Sec |
|---|---:|---:|---:|---:|---:|---:|:-:|---:|---:|---:|
| sample-isp-intake | 2 | 100.0% | 100.0% | 94.7% | 0.0% | 100.0% | ✓ | 0 | 0 | 0.3 |
| **Mean** | | **100.0%** | 100.0% | **94.7%** | 0.0% | 100.0% | 1/1 | 0 | | |

Targets (project brief): field recall ≥ 85%, type accuracy ≥ 90%, 100% valid.

