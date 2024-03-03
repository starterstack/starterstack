# -*- coding: utf-8 -*-

import json
import os
import traceback

from pprint import pprint


def handler(event, context):
    pprint({"event": event})
    email = None
    try:
        email = event["requestContext"]["authorizer"]["email"]
    except KeyError:
        pass
    if email:
        body_json = {"hello": f"Hej {email}! from python"}
    else:
        body_json = {"hello": "Hej! from python"}

    return {
        "statusCode": 200,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(body_json),
    }
