# ses

### SES Setup and templates.

Test receive locally with [SWAKS](https://jetmore.org/john/code/swaks/installation.html).

```sh
./scripts/local-ses-receive.sh
```

### VerifySES Custom resource

ConfigurationSet, EmailIdentity, ReceiptRule resources are created by a custom resource.

This is for two reasons, cloudformation has no tag support for email identity or configuration sets, and because there can only be one active rule set per supporting region.

[Creating rule sets and receipt rules](https://docs.aws.amazon.com/ses/latest/dg/receiving-email-receipt-rules-console-walkthrough.html)
