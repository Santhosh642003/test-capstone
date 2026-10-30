# eval/

- `pdfs/` blank state PDFs, `gold/` hand-built Form.io definitions with the same base name.
- `results/<promptVersion>.md` — committed output of `npm run eval:forms` for that prompt version.
- `replay/` saved model replies used by `npm run eval:forms -- --replay` to test the harness without network. Replay scores are NOT model-quality results.
- Add real state PDFs + gold forms here (private folder or blob container if redistribution is restricted). One gold form (`sample-isp-intake`, the fictional demo form) is included so the harness runs out of the box.
