# ⚡ serverless monorepo stack ⚡

WIP

CloudFormation stacks

```mermaid
  graph LR;
    backup --- deployment
    backup --- monitoring
    budget --- deployment
    budget --- monitoring
    cdn --- deployment
    cdn --- monitoring
    cdn --- stack
    cdn --- cloudformation
    cdn --- region
    cdn --- media
    cdn --- rest
    cdn --- web
    cdn --- graphql
    cloudtrail --- deployment
    cloudtrail --- monitoring
    deployment --- monitoring
    dynamodb --- deployment
    dynamodb --- monitoring
    dynamodb-stack-audit --- deployment
    dynamodb-stack-audit --- monitoring
    dynamodb-stack-audit --- eventbus
    dynamodb-stack-audit --- dynamodb
    eventbus --- deployment
    eventbus --- monitoring
    graphql --- deployment
    graphql --- monitoring
    graphql --- dynamodb
    graphql --- stage
    graphql --- eventbus
    iam --- deployment
    iam --- monitoring
    media --- deployment
    media --- monitoring
    media --- dynamodb
    media --- eventbus
    monitoring --- deployment
    notification --- deployment
    notification --- monitoring
    notification --- eventbus
    notification --- ses
    region --- deployment
    region --- monitoring
    rest --- deployment
    rest --- monitoring
    rest --- dynamodb
    rest --- stage
    rest --- eventbus
    ses --- deployment
    ses --- monitoring
    ses --- eventbus
    ses --- stack
    stack --- deployment
    stack --- monitoring
    stage --- deployment
    stage --- monitoring
    stage --- dynamodb
    test --- deployment
    test --- monitoring
    test --- eventbus
    test --- dynamodb
    test --- media
    tracking --- deployment
    tracking --- monitoring
    tracking --- dynamodb
    tracking --- eventbus
    web --- deployment
    web --- monitoring
    web --- stage
```
