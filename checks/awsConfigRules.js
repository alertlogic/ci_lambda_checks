var config          = require('../config.js'),
    AWS             = require('aws-sdk'),
    checkName       = "awsConfigRules",
    awsConfigRules  = function(_snapshotEvent, inScope, awsRegion, vpcId, rawMessage, callback) {
    "use strict";
    AWS.config.update({region: awsRegion});

    var awsConfig       = new AWS.ConfigService(),
        params      = {
            "ResourceId":   rawMessage.configurationItem.resourceId,
            "ResourceType": rawMessage.configurationItem.resourceType
        };

    console.log("awsConfigRules: Analyzing: '" + JSON.stringify(params) +
                "'. Item Status: '" + rawMessage.configurationItem.configurationItemStatus + "'.");
    if (rawMessage.configurationItem.configurationItemStatus === "OK" ||
        rawMessage.configurationItem.configurationItemStatus === "ResourceDiscovered") {
        
        executeAwsApi(awsConfig.getComplianceDetailsByResource.bind(awsConfig), params, function(err, result) {
            if (err) {
                console.log("awsConfigRules check failed. ResourceId: '" + rawMessage.configurationItem.resourceId +
                            "', Region: '" + awsRegion + "'. getComplianceDetailsByResource returned: " + JSON.stringify(err));
                return callback(null, false);
            }
            var vulnerabilities = [];
            for (var i = 0; i < result.EvaluationResults.length; i++) {
                console.log("Resource '" + JSON.stringify(params) + "' is " + result.EvaluationResults[i].ComplianceType);
                if (result.EvaluationResults[i].ComplianceType === "COMPLIANT") {
                    continue;
                }
                vulnerabilities.push(getVulnerability(result.EvaluationResults[i].EvaluationResultIdentifier));
            }
            if (vulnerabilities.length) {
                return callback(null, {vulnerable: true, vulnerabilities: vulnerabilities});
            } else {
                return callback(null, false);
            }
        }); 
    }
};

function getVulnerability(evaluationResult) {
    "use strict";
    var vulnerabilityScope  = getResourceTypeScope(evaluationResult.EvaluationResultQualifier.ResourceType),
        ruleName            = evaluationResult.EvaluationResultQualifier.ConfigRuleName.toLowerCase(),
        evidence            = JSON.stringify(evaluationResult),
        check               = config.checks[checkName],
        vulnerability       = {};

    if (check.configuration.vulnerabilities.hasOwnProperty(ruleName)) {
        vulnerability = check.configuration.vulnerabilities[ruleName];
        vulnerability['scope'] = vulnerabilityScope;
        vulnerability['evidence'] = evidence;
    } else {
        vulnerability = {
            id: "custom-aws-config-rule-" + ruleName,
            name: "AWS Config '" + ruleName + "' Rule Violation",
            description: "AWS Config Rules detected '" + ruleName + "' rule violation.",
            remediation: "Remediate '" + ruleName + "' AWS Config Rule violation",
            resolution: "Refer to '" + ruleName + "' publisher documentation for instructions on how to remediate this violation",
            pci_concern:"N/A",
            ccss_vector: "N/A",
            evidence: evidence,
            type : "application/json"
        };
    }
    return vulnerability;
}

function getResourceTypeScope(resourceType) {
    "use strict";
    switch(resourceType) {
        case    "AWS::EC2::Subnet":         return "subnet";
        case    "AWS::EC2::SecurityGroup":  return "security group";
        case    "AWS::EC2::Instance":       return "host";
        case    "AWS::EC2::NetworkAcl":     return "network acl";
        case    "AWS::EC2::RouteTable":     return "route table";
        case    "AWS::EC2::VPC":            return "vpc";
        case    "AWS::EC2::InternetGateway": return "internet gateway";
        default:                            return resourceType;
    }
}

function executeAwsApi(fun, params, callback) {
    "use strict";
    return executeAwsApiEx(fun, params, callback, null, 10);
}

function executeAwsApiEx(fun, params, callback, lastError, retries) {
    "use strict";
    if (!retries) {
        console.log("Maximum retries number reached... fun: " + fun.toString() + ", params: '" + JSON.stringify(params) + "'.");
        return callback(lastError, null);
    }

    fun(params, function(err, data) {
        if (err) {
            switch(err.code) {
                case 'RequestLimitExceeded':
                case 'ThrottlingException':
                    setTimeout(function() {
                        return executeAwsApiEx(fun, params, callback, err, retries - 1);
                    }, 5000);
                    break;
                default:
                    return callback(err, data);
            }
        } else {
            return callback(err, data);
        }
    });
}

module.exports = awsConfigRules;

