starterstack = softwareSystem "Starterstack" "Reference architecture." {
  tags "starterstack"

  stackTable = container "Stack Table" "Stores information about users" "DynamoDB" {
    tags "Amazon Web Services - DynamoDB"
  }

  webSocketTable = container "WebSocket Table" "Stores websocket connections" "DynamoDB" {
    tags "Amazon Web Services - DynamoDB"
  }

  auditTable = container "Audit Table" "Stores versioned data" "DynamoDB" {
    tags "Amazon Web Services - DynamoDB"
  }

  route53 = container "DNS" "starterstack" "Route 53" {
    tags "Amazon Web Services - Route 53"
  }

  cloudFrontWAF = container "CDN WAF" "Protects CDN" "WAF" {
    tags "Amazon Web Services - WAF"
  }

  cloudFront = container "CDN" "Caches and serves static and dynamodb content" "CloudFront" {
    tags "Amazon Web Services - CloudFront"
  }

  cloudFrontFunctions = container "CloudFront functions" "Process origin requests and responses" {
    cloudFront -> this
  }

  apiGatewayWebSocket = container "API WebSocket Gateway" "websocket api" {
    tags "Amazon Web Services - Amazon API Gateway"
    cloudFront -> this "calls" "wss"
  }

  apiGatewayWAF = container "Api Gateway WAF" "Protects Api Gateway" "WAF" {
    tags "Amazon Web Services - WAF"
    cloudFront -> this "calls"
  }

  apiGatewayHttp = container "API HTTP Gateway" "https api"{
    tags "Amazon Web Services - Amazon API Gateway"
    apiGatewayWAF -> this "calls" "https"
  }

  ssm = container "Parameter Store" "SSM" {
    tags "Amazon Web Services - AWS Systems Manager Parameter Store"
  }

  authorizer = container "API Authorizer" "validates session, jwt and roles" "lambda" {
    tags "Amazon Web Services - AWS Lambda Lambda Function"
    this -> stackTable "reads/writes user data" "https"
    this -> ssm "reads config" "https"
    apiGatewayHttp -> this "calls" "https"
    apiGatewayWebSocket -> this "calls" "https"
  }

  websocket = container "WebSocket Lambda" "websocket stack" {
    tags "Amazon Web Services - Lambda"
    authorizer -> this "calls" "https"
    this -> webSocketTable "writes/deletes" "https"
  }

  acm = container "Certificates" "Serves starterstack certificates" "ACM" {
    tags "Amazon Web Services - Certificate Manager"
  }
  cloudfront -> acm "uses"

  s3Static = container "S3 Static Bucket" "backoffice web application content" {
    tags "Amazon Web Services - Simple Storage Service Bucket With Objects"
  }

  container "Single Page Application" "React" {
    s3Static -> this
  }

  s3Media = container "S3 Media Bucket" "media content" {
    tags "Amazon Web Services - Simple Storage Service Bucket With Objects"
  }

  route53 -> cloudFrontWAF
  cloudFrontWAF -> cloudFront
  cloudFront -> s3Static
  cloudFront -> s3Media

  bus = container "EventBus" "EventBridge" {
    tags "Amazon Web Services - EventBridge"
  }

  container "archive" "Store all events for future use" {
    bus -> this "archive"
  }

  rest = container "User rest API" "handle user login events and session" "rest stack" {
    tags "Amazon Web Services - CloudFormation"
    this -> stackTable "reads/writes user data" "https"
    this -> ssm "reads config" "https"
    this -> bus "posts events" "https"
    authorizer -> this "calls" "https"
  }

  graphql = container "GraphQL API" "handle queries, mutations, and subscriptions for booking schema" "graphql stack" {
    tags "Amazon Web Services - AWS Lambda Lambda Function"
    this -> stackTable "reads/writes user data" "https"
    this -> ssm "reads config" "https"
    this -> bus "posts events" "https"
    authorizer -> this "calls" "https"
  }

  container "EventBridge Pipe" "process stack data" {
    tags "Amazon Web Services - EventBridge Pipes"
    stackTable -> this "handle scheduled TTL documents"
    stackTable -> this "process booking audit data"
    this -> auditTable
  }

  notification =  container "Notification" "Sends email, and sms messages", "notification stack" {
    tags "Amazon Web Services - AWS Lambda Lambda Function"
    this -> stackTable "reads/writes user data" "https"
    this -> ssm "reads config" "https"
    bus -> this "triggers"
  }

}
