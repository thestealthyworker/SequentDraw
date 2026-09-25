# polyglot fixture

One small repository per ecosystem that `@specfy/stack-analyser` used to read for
SequentDraw, so the vendored parsers in `src/scan/rules/` can be proven to produce the
same evidence (build step 8a). Nothing here is meant to build or run.

Each file exercises an edge the original parser handles: an indirect Go module, a Rust
path/git dependency, a Composer file with no `name`, a Compose image from a variable,
Terraform resources that do and do not match a known technology, and a GitHub Actions
job with a container and services.
