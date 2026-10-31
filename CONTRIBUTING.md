# Contributing

Thanks for taking an interest. The rules are short and live in [AGENTS.md](AGENTS.md); they apply to people and AI
agents alike.

1. Open an issue first for anything larger than a fix, so we can agree on the approach.
2. Write the change yourself or with an agent, from the specification and the Home Assistant docs, not from other
   projects' code.
3. Run `python3 tools/guard.py`, `python3 -m unittest discover -s tests` and `node --test "tests/**/*.test.mjs"`.
4. Add a provenance trailer to every commit: `Provenance: human`, or `Provenance: agent <tool>/<model>` with an
   optional `; brief <id>`. As the person submitting, sign off (`git commit -s`, the
   [Developer Certificate of Origin](https://developercertificate.org/)); agents never sign off.
5. Use anonymized captures only (`tools/anonymize_capture.py`); never post real ones in issues or pull requests.

By contributing you agree that your work is published under the MIT License.
