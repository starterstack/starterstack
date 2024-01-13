workspace "starterstack" "Starterstack" {

    !identifiers hierarchical
    !impliedRelationships true
    !docs doc
    !adrs doc/adr

    model {
        !include aws.dsl

        user = person "user" "User."
        developer = person "Developer user" "A starterstack Developer."

        sentry = softwareSystem "Sentry" "Report API errors."

        slack = softwareSystem "Slack" "Receives ops and alarm events."
        github = softwareSystem "GitHub" "Manages our code and deployments."

        starterstack -> slack
        starterstack -> sentry
        github -> starterstack

        user -> starterstack "user access to starterstack." "https"

        user -> starterstack.rest
        user -> starterstack.graphql

        starterstack.apiGatewayWebSocket -> user "real time updates" "wss"

        starterstack.notification -> sentry "report errors" "https"
        starterstack.cloudFrontWAF -> sentry "report errors" "https"
        starterstack.notification -> user "sends email using SES"

        developer -> github "codes and deploys"  "git|https"
        developer -> sentry "access issues" "https"
        developer -> slack "read events" "https"
    }

    views {
        systemLandscape starterstack landscape {
          include *
        }

        systemContext starterstack context {
          include *
        }

        container starterstack container {
          include *
        }

        styles {
          element "Software System" {
            background #dddddd
            color #232323
          }
          element "starterstack" {
            background #1168bd
            color #cfdef1
          }
          element "Amazon Web Services - DynamoDB" {
            shape cylinder
          }
        }

        theme https://static.structurizr.com/themes/amazon-web-services-2023.01.31/icons.json
        theme https://static.structurizr.com/themes/default/theme.json

    }

}
