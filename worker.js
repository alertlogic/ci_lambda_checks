var async           = require('async'),
    winston         = require('winston'),
    config          = require('./config.js'),
    pkg             = require('./package.json'),
    assets          = require('./utilities/assets.js'),
    publishResult   = require('./utilities/publish.js'),
    checksUtils     = require('./utilities/checks.js');

exports.handler = function(args, context) {
    "use strict";
    
    var params = {
            token: args.token,
            awsRegion: args.awsRegion,
            vpcs: args.vpcs,
            eventType: args.eventType,
            resourceType: "",
            resourceId: "",
            whitelist: args.whitelist,
            tags: {},
            vpcId: null,
            inScope: true,
            message: args.message
        };

    switch(params.eventType) {
        case 'configRule':
            params.resourceType    = params.message.resourceType;
            params.resourceId      = params.message.resourceId;
            break;

        case 'snapshotEvent':
        case 'configurationItem':
            params.resourceType    = params.message.configurationItem.resourceType;
            params.resourceId      = params.message.configurationItem.resourceId;
            params.tags            = params.message.configurationItem.tags;
            break;

        case 'scheduledEvent':
            break;

        default:
            winston.error("Worker [%s:%s]: Unsupported message: '%s', Args: '%s'", 
                          config.accountId, config.environmentId, JSON.stringify(params.message), JSON.stringify(args));
            return context.fail();
    }

    config.accountId       = args.accountId;
    config.environmentId   = args.environmentId;

    params.vpcId = getVpcId(params.eventType, params.resourceType, params.resourceId, params.message);

    // Tell checks if the vpc in scope.
    if (params.vpcId && params.vpcs.indexOf(params.vpcId) === -1) {
        params.inScope = false;
    }

    winston.info("Worker [%s:%s]: Params: '%s'", config.accountId, config.environmentId, JSON.stringify(params));

    applyChecks(params, function(err) {
        if (err) {
            winston.error("Worker [%s:%s]: Failed to handle driver message. Args: '%s', Error: '%s'.",
                          config.accountId, config.environmentId, JSON.stringify(args), JSON.stringify(err));
            return context.fail();
        } else {
            winston.info("Worker [%s:%s]: Successfully handled driver message.",
                         config.accountId, config.environmentId);
            return context.succeed();
        }
    });
};

function applyChecks(params, resultCallback) {
    "use strict";
    winston.info("Worker [%s:%s]: Applying checks. Params: '%s'", config.accountId, config.environmentId, JSON.stringify(params));
    async.each(config.checks, function (check, callback) {
        if (!validateCheck(check, params)) {
            return callback();
        }

        try {
            var test = require('./checks/' + check.name.toString() + '.js'),
                metadata = getMetadata(check.name.toString(), params.awsRegion, params.resourceType, params.resourceId);
            winston.info("Worker [%s:%s]: Executing '%s' custom check. ResourceType: '%s', ResourceId: '%s'",
                          config.accountId, config.environmentId, check.name.toString(), params.resourceType, params.resourceId);

            test(params, function(err, result) {
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
                        if (result.hasOwnProperty('data')) {
                            async.each(Object.getOwnPropertyNames(result.data), function(assetName, cb) {
                                console.log('Processing %s asset. ResourceType: %s', assetName, result.data[assetName].resourceType);
                                var metadata = getMetadata(
                                    check.name.toString(),
                                    params.awsRegion,
                                    result.data[assetName].resourceType,
                                    assetName);
                                publishResult(params.token, metadata, result.data[assetName].vulnerabilities, cb);
                            }, function(err) {
                                callback(null);
                            });
                        } else if (result.hasOwnProperty('vulnerabilities')) {
                            publishResult(params.token, metadata, result.vulnerabilities, callback);
                        } else if (result.hasOwnProperty('evidence')) {
                            var vulnerability = check.vulnerability;
                            vulnerability.evidence = JSON.stringify(result.evidence);
                            publishResult(params.token, metadata, [vulnerability], callback);
                        } else {
                            publishResult(params.token, metadata, [check.vulnerability], callback);
                        }
                    } else if (result === true) {
                        // Publish a result against the available metadata
                        publishResult(params.token, metadata, [check.vulnerability], callback);
                    } else {
                        // Clear a result against the available metadata
                        publishResult(params.token, metadata, [], callback);
                    }
                }
            });
        } catch (e) {
            // Continue processing other checks
            winston.error("Worker [%s:%s]: '%s' custom check threw an exception. Error: %s.",
                          config.accountId, config.environmentId, check.name.toString(), JSON.stringify(e));
            callback();
        }
    },
    function(err){
        if (err) {
            winston.error("Worker [%s:%s]: Failed to handle driver message. Params: '%s', Error: '%s'.",
                          config.accountId, config.environmentId, JSON.stringify(params), JSON.stringify(err));
            return resultCallback(err);
        } else { 
            winston.info("Worker [%s:%s]: Successfully handled driver message.",
                         config.accountId, config.environmentId);
            return resultCallback();
        }
    });
}

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

function validateCheck(check, params) {
    "use strict";

    if (check.enabled !== true) {
        winston.info("Worker [%s:%s]: '%s' custom check is disabled",
                     config.accountId, config.environmentId, check.name.toString());
         return false;
    }

    if (!checksUtils.validateCheckName(check.name.toString())) {
        winston.error("Worker [%s:%s]: Invalid check name. Use only alphanumeric values. Check name: '%s'",
                      config.accountId, config.environmentId, check.name.toString());
        return false;
    }

    if (!checksUtils.validateRegion(check, params.awsRegion)) {
        winston.info("Worker [%s:%s]: Unsupported region for the check '%s'. Region: '%s'",
            config.accountId, config.environmentId, check.name.toString(), params.awsRegion);
        return false;
    }

    // Validate event's type or resourceType
    var checkMode = checksUtils.getCheckMode(check);
    if (!checksUtils.isValidMode(checkMode, params.eventType)) {
        winston.info("Worker [%s:%s]: Skipping execution of the check '%s'. EventType: '%s'. Supported types: '%s'",
                     config.accountId, config.environmentId, check.name.toString(), params.eventType, checkMode); 
        return false;
    }

    if (!checksUtils.validateResourceType(check, params.resourceType)) {
        winston.info("Worker [%s:%s]: Unsupported resource type for the check '%s'. Record ResourceType: '%s'. Supported types: '%s'",
                     config.accountId, config.environmentId, check.name.toString(), params.resourceType, check.configuration.resourceTypes.toString());
        return false;
    }

    return true;
}

function getVpcId(eventType, resourceType, resourceId, message) {
    "use strict";
    var vpcId = null;
    switch (eventType) {
        case 'scheduledEvent':
            break;
        case 'configRule':
            if (!message.hasOwnProperty('configurationItem')) {
                break;
            }
            if (message.configurationItem.configurationItemStatus === "ResourceDeleted") {
                // Deleted resources have a different config item layout
                vpcId = message.configurationItemDiff.changedProperties.Configuration.previousValue.vpcId;
            } else {
                if (message.configurationItem.hasOwnProperty("configuration") &&
                        message.configurationItem.configuration.hasOwnProperty("vpcId")) {
                    vpcId = message.configurationItem.configuration.vpcId;
                } else {
                    if (message.configurationItem.hasOwnProperty('relationships')) {
                        var relationships   = message.configurationItem.relationships;
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
            break;
        default:
            if (resourceType === "AWS::EC2::VPC") {
                vpcId = resourceId;
            }
            break;
    }
    return vpcId;
}
