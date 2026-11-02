# Security

Report security problems privately through GitHub: Security tab, "Report a vulnerability". Do not open a public issue.

Include:

- what you found and which component it concerns,
- the version and the Home Assistant version,
- the steps to reproduce it and what an attacker gains.

Never post tokens, network keys or captures with real device names or IEEE addresses publicly, in a report either.
Describe them, or anonymize a capture with `tools/anonymize_capture.py` first.

In scope: anything that could expose network keys, write to a Zigbee or Thread network, run code from device or user
supplied names, or send data outside the Home Assistant instance. You will get an answer within a week.
