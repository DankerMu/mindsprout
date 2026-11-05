---
name: implement
description: "Implement a piece of work based on a spec or set of tickets."
disable-model-invocation: true
version: 0.1.1
---

Implement the work described by the user in the spec or tickets.

Use /tdd and /vdd where possible, at the seams the spec names; when it names none, test at the public boundaries the change's consumers use.

Run typechecking regularly, single test files regularly, and the full test suite once at the end.

Once done, use the `review` skill to review the work.

Commit your work to the current branch.
