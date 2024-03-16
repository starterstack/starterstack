# 4. Use Serverless Application Model to describe our infrastructure

Date: 2024-03-16

## Status

Accepted

## Context

Use an imperative technique to describe infrastructure as code, keep the structure consistent for all CloudFormation stacks.

## Decision

Use [SAM](https://github.com/aws/serverless-application-model) infrastructure as code templates.

Use [sam-expand](https://github.com/starterstack/sam-expand) to test, validate, build, and deploy stacks.

## Consequences

Consistent structure for CloudFormation stacks, with the flexibility `sam-expand` brings.
