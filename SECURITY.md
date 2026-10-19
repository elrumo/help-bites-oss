# Security policy

## Reporting a vulnerability

Please report it privately through GitHub: **Security → Report a vulnerability** on
[elrumo/help-bites-oss](https://github.com/elrumo/help-bites-oss/security/advisories/new). Do not open a public issue.

Include what you found, how to reproduce it, and the version (`GET /v1/meta` reports the commit). You will get an
acknowledgement within a few days. Please give us a reasonable window to ship a fix before disclosing.

## Supported versions

Security fixes go into the latest release. Upgrade with `docker compose pull && docker compose up -d`
(see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#upgrades)).

## Hardening your own deployment

[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#security-checklist) has a checklist. The essentials:
- never give `sb-parse` a public domain: it holds the master key;
- finish the first-operator setup right after you deploy, since whoever opens it first becomes the owner;
- keep real values in `.env` for `PARSE_MASTER_KEY` and `MEILI_MASTER_KEY` (`scripts/install.sh` generates them);
  production refuses to start with the `change-me` placeholders.
