var async           = require('async'),
    winston         = require('winston'),
    config          = require('./config.js'),
    pkg             = require('./package.json'),
    assets          = require('./utilities/assets.js'),
    publishResult   = require('./utilities/publish.js');

exports.handler = function(args, context) {
    "use strict";
    
    var rawMessage      = args.message,
        resourceType    = rawMessage.configurationItem.resourceType,
        resourceId      = rawMessage.configurationItem.resourceId,
        token           = args.token,
        awsRegion       = args.awsRegion,
        vpcs            = args.vpcs,
        snapshotEvent   = args.snapshotEvent,
        vpcId           = null,
        inScope         = true;

    config.accountId       = args.accountId;
    config.environmentId   = args.environmentId;
    winston.debug("Worker [%s:%s]: Handler called: %s", config.accountId, config.environmentId, JSON.stringify(args));

    if (resourceType === "AWS::EC2::VPC") {
        vpcId = resourceId;
    } else {
        if (rawMessage.configurationItem.configurationItemStatus === "ResourceDeleted") {
            // Deleted resources have a different config item layout
            vpcId = rawMessage.configurationItemDiff.changedProperties.Configuration.previousValue.vpcId;
        } else {
            if (rawMessage.configurationItem.hasOwnProperty("configuration") &&
                rawMessage.configurationItem.configuration.hasOwnProperty("configurationItem") &&
                rawMessage.configurationItem.configurationItem.hasOwnProperty("vpcId")) {
                vpcId = rawMessage.configurationItem.configurationItem.vpcId;
            } else {
                var relationships   = rawMessage.configurationItem.relationships;
                for (var i = 0; i < relationships.length; i++) {
                    if (relationships[i].resourceType === "AWS::EC2::VPC" &&
                        relationships[i].name === "Is contained in Vpc") {
                        vpcId = relationships[i].resourceId;
                        break;
                    }
                }
            }
        }
    }
        
    // Tell checks if the vpc in scope.
    if (vpcId && vpcs.indexOf(vpcId) === -1) {
        inScope = false;
    }

    winston.info("Worker [%s:%s]: Resource inScope: '%s'. ResourceType: '%s'. ResourceId: '%s', VPC: '%s'. VPCs in scope: '%s'.",
                  config.accountId, config.environmentId, inScope, resourceType, resourceId, vpcId, vpcs.toString());
    async.each(config.checks, function (check, callback) {
        if (check.enabled === true) {

            if (!isCheckNameValid(check.name.toString())) {
                winston.error("Worker [%s:%s]: Invalid check name. Use only alphanumeric values. Check name: '%s'",
                              config.accountId, config.environmentId, check.name.toString());
                return callback();
            }

            winston.debug("Worker [%s:%s]: Check '%s' is enabled",
                          config.accountId, config.environmentId, check.name.toString());
            //
            // Don't do anything if the check isn't applicable to the event's resourceType
            //
            if (-1 === check.configuration.resourceTypes.indexOf(resourceType)) {
                winston.info("Worker [%s:%s]: Skipping execution of the check '%s'. Record ResourceType: '%s'. Supported types: '%s'",
                             config.accountId, config.environmentId, check.name.toString(), resourceType, check.configuration.resourceTypes.toString()); 
                return callback();
            }

            try {
                var test = require('./checks/' + check.name.toString() + '.js'),
                    metadata = getMetadata(check.name.toString(), awsRegion, resourceType, resourceId);
                winston.debug("Worker [%s:%s]: Executing '%s' custom check. ResourceType: '%s', ResourceId: '%s'",
                              config.accountId, config.environmentId, check.name.toString(), resourceType, resourceId);

                test(snapshotEvent, inScope, awsRegion, vpcId, rawMessage, function(err, result) {
                    if (err) {
                        winston.error("Worker [%s:%s]: '%s' custom check failed. Error: %s",
                                      config.accountId, config.environmentId, check.name.toString(), JSON.stringify(err));
                        return callback();
                    } else {
                        console.log("Worker [%s:%s]: '%s' custom check returned: %s. Typeof: %s",
                                    config.accountId, config.environmentId,
                                    check.name.toString(), JSON.stringify(result),
                                    typeof result);
                        if (typeof result === 'object' && result.vulnerable === true) {
                            if (result.hasOwnProperty('vulnerabilities')) {
                                publishResult(token, metadata, result.vulnerabilities, callback);
                            } else if (result.hasOwnProperty('evidence')) {
                                var vulnerability = check.vulnerability;
                                vulnerability.evidence = JSON.stringify(result.evidence);
                                publishResult(token, metadata, [vulnerability], callback);
                            } else {
                                publishResult(token, metadata, [check.vulnerability], callback);
                            }
                        } else if (result === true) {
                            // Publish a result against the available metadata
                            publishResult(token, metadata, [check.vulnerability], callback);
                        } else {
                            // Clear a result against the available metadata
                            publishResult(token, metadata, [], callback);
                        }
                    }
                });
            } catch (e) {
                winston.error("Worker [%s:%s]: '%s' custom check threw an exception. Error: %s.",
                              config.accountId, config.environmentId, check.name.toString(), JSON.stringify(e));
                callback();
            }
        } else {
            winston.info("Worker [%s:%s]: '%s' custom check is disabled",
                         config.accountId, config.environmentId, check.name.toString());
            callback();
        }
    },
    function(err){
        if (err) {
            winston.error("Worker [%s:%s]: Failed to handle driver message. Args: '%s', Error: '%s'.",
                          config.accountId, config.environmentId, JSON.stringify(args), JSON.stringify(err));
            return context.fail();
        } else { 
            winston.info("Worker [%s:%s]: Successfully handled driver message. Subject: '%s'.",
                         config.accountId, config.environmentId, args.record.Sns.Subject);
            return context.succeed();
        }
    });
};

function getMetadata(checkName, awsRegion, resourceType, resourceId) {
    "use strict";
    return {
        scanner: "custom",
        scanner_scope: "custom" + checkName.toLowerCase(),
        timestamp: Math.round(+new Date()/1000),
        asset_id: assets.getAssetKey(awsRegion, resourceType, resourceId),
        environment_id: config.environmentId,
        scan_policy_snapshot_id: "custom_snapshot_" + checkName + "_v" + pkg.version,
        content_type: "application/json"
    };
}

function isCheckNameValid(checkName) {
    "use strict";
    return (null != checkName.match("^[a-zA-Z0-9]*$"));
}
