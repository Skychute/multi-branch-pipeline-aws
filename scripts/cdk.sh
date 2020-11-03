#!/bin/bash
set -e

npx cdk deploy "*" --require-approval never
