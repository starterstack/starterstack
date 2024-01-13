# 1. Add Web Access Firewall for CloudFront

Date: 2023-03-21

## Status

Accepted

## Context

AWS have advised us to protect our CloudFront distribution by adding a WAF.
This will both protect us of a DDOS attack and give us the opportunity to protect our APIs further.

## Decision

Add WAF using CloudFormation, the WAF is still configurable and can be turned off on an account level if required.

## Consequences

The charge for WAF will now be double, because we need both a WAF for CloudFront and also for API Gateway.
