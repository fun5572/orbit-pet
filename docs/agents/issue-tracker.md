# Issue tracker: Local Markdown

Issues and specs for this repo live as Markdown files in `.scratch/`.

## Conventions

- One feature per directory: `.scratch/<feature-slug>/`
- The spec is `.scratch/<feature-slug>/spec.md`
- Implementation issues use one file per ticket:
  `.scratch/<feature-slug>/issues/<NN>-<slug>.md`
- Comments and history are appended under `## Comments`

## Publishing

When a skill says “publish to the issue tracker”, create the corresponding
file under `.scratch/<feature-slug>/`.

## Fetching

Read the referenced Markdown ticket directly. The user normally supplies its
path or number.
