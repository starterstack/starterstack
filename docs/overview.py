from diagrams import Cluster, Diagram, Edge
from diagrams.aws.storage import S3
from diagrams.aws.network import CloudFront, APIGateway, Route53
from diagrams.aws.compute import Lambda
from diagrams.aws.database import Dynamodb
from diagrams.aws.integration import Eventbridge, SimpleNotificationServiceSnsTopic
from diagrams.aws.engagement import SES
from diagrams.aws.security import ACM
from diagrams.aws.management import ParameterStore
from diagrams.aws.security import WAF
import json

with open("../packages/settings.json", "r") as f:
    settings = json.load(f)

stack_display_name = settings["stackDisplayName"]
root_domain = settings["rootDomain"]
accounts = settings["awsAccounts"].values()

prod_account = next((acc for acc in accounts if acc["stage"].startswith("prod")), None)
waf_enabled = prod_account is not None and prod_account.get("wafEnabled", False)

graph_attr = {
    "fontsize": "28",
    "bgcolor": "white",
    "label": f"\n{stack_display_name} overview\n",
    "labelloc": "top",
    "pad": "0.5",
}

node_attr = {
    "fontsize": "14",
    "pad": "0.5",
}

with Diagram(
    "overview",
    show=False,
    direction="TB",
    filename="overview",
    graph_attr=graph_attr,
    node_attr=node_attr,
    edge_attr=node_attr,
):

    if waf_enabled:
        cf_waf = WAF("waf")
        api_waf = WAF("waf")

    zone = Route53(root_domain)
    cert = ACM(root_domain)

    zone - cert
    distribution = CloudFront("CloudFront distribution")
    db = Dynamodb("DynamoDB table")
    ses = SES("ses")
    s3_email_bucket = S3("email")

    ssm = ParameterStore("Parameter Store")

    ses_receive = Lambda("ses-receive (email)")
    ses >> ses_receive
    ses_receive >> s3_email_bucket

    custom_bus = Eventbridge("Event Bus (custom)")
    custom_bus >> Eventbridge("Archive")
    default_bus = Eventbridge("Event Bus (default)")

    api = [
        APIGateway("API Gateway (rest api)"),
        APIGateway("API Gateway (websocket)"),
    ]

    agw_http = api[0]
    agw_ws = api[1]

    s3 = [S3("static"), S3("media"), S3("protected media")]

    media_bucket = s3[1]
    protected_media_bucket = s3[2]

    with Cluster("api lambdas"):
        login = Lambda("login")
        session = Lambda("session")
        rest = [
            Lambda("..."),
            login,
            session,
        ]

    graphql = [Lambda("graphql")]
    web = [Lambda("web ssr")]

    websocket = [Lambda("websocket")]

    authorizer = Lambda("authorizer")

    authorizer - db

    agw_http >> authorizer >> web
    agw_http >> authorizer >> rest
    agw_http >> authorizer >> graphql
    agw_ws >> authorizer >> websocket

    if waf_enabled:
        zone - cf_waf
        cf_waf >> distribution
        distribution >> api_waf
        api_waf >> agw_http
    else:
        zone - distribution
        distribution >> agw_http

    zone - ses

    distribution >> agw_ws
    distribution >> s3

    login - db
    session - db
    graphql - db
    login - ssm
    session - ssm
    graphql - ssm

    login >> custom_bus

    (
        custom_bus
        >> Lambda("login-email")
        >> ses
        >> SimpleNotificationServiceSnsTopic("email delivery topic")
        >> Lambda("ses-events")
    )

    media_bucket >> default_bus
    protected_media_bucket >> default_bus

    default_bus >> Lambda("media")
