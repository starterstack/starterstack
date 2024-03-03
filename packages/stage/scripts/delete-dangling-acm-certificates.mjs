#!/usr/bin/env node

// @ts-check

import assert from 'node:assert'
import process from 'node:process'

import {
  Route53Client,
  ChangeResourceRecordSetsCommand,
  ListResourceRecordSetsCommand
} from '@aws-sdk/client-route-53'
import {
  ACMClient,
  DescribeCertificateCommand,
  ListCertificatesCommand
} from '@aws-sdk/client-acm'

/** @typedef {import('@aws-sdk/client-route-53').RRType} RRType} */

const [hostedZoneId, region] = process.argv.slice(2)

assert.ok(hostedZoneId, 'missing zone id')

if (region !== 'us-east-1') {
  process.exit(0)
}

const route53 = new Route53Client({ region: 'us-east-1' })
const acm = new ACMClient({ region: 'us-east-1' })

const abortSignal = AbortSignal.timeout(6000)

const domainValidationOptions = await getDomainValidationOptions({
  acm,
  abortSignal
})

const deleteDangling = []

for await (const batch of listDns({ route53, abortSignal })) {
  for (const {
    Name: name,
    Type: type,
    ResourceRecords: resourceRecords,
    TTL: ttl
  } of batch) {
    if (
      !resourceRecords.every(function hasDNS(resourceRecord) {
        return domainValidationOptions.has(
          `${name}.${type}.${resourceRecord.Value}`
        )
      })
    ) {
      deleteDangling.push({
        Action: 'DELETE',
        ResourceRecordSet: {
          Name: name,
          ResourceRecords: resourceRecords,
          TTL: ttl,
          Type: type
        }
      })
    }
  }
}

if (deleteDangling.length > 0) {
  console.log('dns changes %s', JSON.stringify(deleteDangling, undefined, 2))
  await route53.send(
    new ChangeResourceRecordSetsCommand({
      HostedZoneId: hostedZoneId,
      ChangeBatch: {
        Changes: deleteDangling
      }
    }),
    {
      abortSignal
    }
  )
}

async function* listDns({ route53, abortSignal }) {
  /** @type {{
   StartRecordName: RRType | undefined
   StartRecordType: RRType | undefined
   StartRecordIdentifier: string | undefined
  } | undefined} */
  let next
  let truncated = true
  while (truncated) {
    const {
      IsTruncated,
      NextRecordName,
      NextRecordType,
      NextRecordIdentifier,
      ResourceRecordSets
    } = await route53.send(
      new ListResourceRecordSetsCommand({
        HostedZoneId: hostedZoneId,
        MaxItems: 25,
        ...next
      }),
      { abortSignal }
    )

    const certificationValidation = ResourceRecordSets.filter(
      function isACMValidation(record) {
        return (
          record.Type === 'CNAME' &&
          record.ResourceRecords.find(function hasACMValidationValue(record) {
            return record?.Value?.includes('.acm-validations.aws.')
          })
        )
      }
    )

    if (certificationValidation.length > 0) {
      yield certificationValidation
    }

    if (IsTruncated) {
      next = {
        StartRecordName: NextRecordName,
        StartRecordType: NextRecordType,
        StartRecordIdentifier: NextRecordIdentifier
      }
      truncated = true
    } else {
      truncated = false
    }
  }
}

async function getDomainValidationOptions({ acm, abortSignal }) {
  const domainValidationOptions = new Set()
  let truncated = true
  /** @type {{
   NextToken: string
  } | undefined} */
  let next
  while (truncated) {
    const { CertificateSummaryList, NextToken } = await acm.send(
      new ListCertificatesCommand({ MaxItems: 25, ...next }),
      { abortSignal }
    )

    if (CertificateSummaryList.length > 0) {
      const details = await Promise.all(
        CertificateSummaryList.map(function getCertificateDetails({
          CertificateArn
        }) {
          return acm.send(new DescribeCertificateCommand({ CertificateArn }), {
            abortSignal
          })
        })
      )
      for (const {
        Certificate: {
          DomainValidationOptions: certificateDomainValidationOptions = []
        } = {}
      } of details) {
        for (const {
          ResourceRecord: resourceRecord
        } of certificateDomainValidationOptions ?? []) {
          if (resourceRecord) {
            const { Name: name, Type: type, Value: value } = resourceRecord
            domainValidationOptions.add(`${name}.${type}.${value}`)
          }
        }
      }
    }
    if (NextToken) {
      truncated = true
      next = { NextToken }
    } else {
      next = undefined
      truncated = false
    }
  }
  return domainValidationOptions
}
