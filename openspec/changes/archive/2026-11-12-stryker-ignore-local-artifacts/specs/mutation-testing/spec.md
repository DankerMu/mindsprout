# Spec Delta

## ADDED Requirements

### Requirement: Local run artifacts stay out of the mutation sandbox

Mutation runs SHALL exclude the root `.run/` and `.workplans/` run-artifact directories from Stryker's project files, so their presence in a local working root does not enter the sandbox. The mutated source set, mutant count and initial test set MUST be the same as in a clean checkout.

#### Scenario: Working root holds large local run artifacts

- **WHEN** `stryker run --dryRunOnly` runs in a working root whose gitignored `.run/` and `.workplans/` hold tens of thousands of files
- **THEN** the dry run completes without exhausting the heap, the sandbox contains neither directory, and the mutated-file, mutant and initial-test counts equal the clean-checkout baseline
