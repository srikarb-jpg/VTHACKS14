# Search versus frontier experiment

Run `npm.cmd run train:binary-router` to rebuild the classifier, then
`npm.cmd run test:binary-router` to evaluate it in a fresh process and measure RAM.
Try a custom prompt with:

```powershell
npm.cmd run test:binary-router -- "Summarize these meeting notes."
```

MiniLM stays frozen. A binary logistic-regression head learns search versus
frontier from 48 synthetic examples; 12 separate validation examples select the
search threshold and 16 held-out examples evaluate the result. Rewrites,
summaries, formatting, and generation all go to frontier in this two-lane policy.
Scores below the search threshold fall back to frontier. Scores are uncalibrated.

The starter set is assistant-authored, small, and contains similar task families
across splits. Perfect performance on it does not establish general accuracy.
Expand with human-reviewed ambiguous, mixed-intent, long, and realistic scrubbed
prompts before deployment. Do not tune against the held-out test set.

Artifacts: `binary-router-model.json` and `binary-router-evaluation.json` here;
memory and latest predictions in `.cache/binary-router/results.json`. False-search
is reported as frontier examples incorrectly sent to search / frontier examples.

Memory is total Node process RSS, including native runtime overhead. Peak is the
OS cumulative process high-water mark. This uses MiniLM quantized weights and
Transformers.js 2.17.2 supplied by the current GLiNER dependency. No GLiNER model
is loaded in this benchmark, and browser/WASM memory will differ. Long inputs
may be truncated by the embedder and are not validated by this starter suite.

This is the standalone model/test implementation. It does not change the live
extension router or send prompts anywhere. Connect it to scrubbed text in the
offscreen inference host only after validating browser behavior.
