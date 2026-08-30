---
type: how-to
---

# Rotate an API key

## Overview

Rotating a key replaces the old secret without interrupting live traffic.

## Before you start

You need an account with the `admin` role.

## Rotate the key

Issue the replacement, then retire the old one.

```bash
widget keys rotate --id abc123
```
