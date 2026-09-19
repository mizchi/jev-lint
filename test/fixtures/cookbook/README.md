One file per grammar, holding one instance of every code shape the recipes in
`skills/jev-lint/references/cookbook.md` match. The test extracts every YAML
block from the cookbook, loads it, and asserts each rule finds at least one
subject here -- so a recipe that stops loading, or a node kind that stops
existing, fails CI instead of failing the first person who copies it.

Not a labelled corpus: nothing here is asked of the model.
