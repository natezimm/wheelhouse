# Security policy

## Reporting a vulnerability

Please report security problems privately, not in a public issue: use **Report a vulnerability** on this repository's [Security tab](https://github.com/natezimm/wheelhouse/security/advisories/new). Include what you found, how to reproduce it and what it lets someone do. You should hear back within a week.

The public demo holds only fictional families and is fine to test against gently (it is rate limited and each visitor gets their own copy). Please do not test against anyone's private family instance, run load tests, or try to reach the server itself.

## Supported versions

Only the latest release is supported; every merge to `main` releases.

## How Wheelhouse is protected

[docs/security.md](docs/security.md) is the threat model: what is protected, from whom, how, and which risks are accepted for now.
