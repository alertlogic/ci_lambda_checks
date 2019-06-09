require('zlib');
var async           = require('async'),
    AWS             = require('aws-sdk'),
    zlib            = require('zlib'),
    _               = require('lodash'),
    configTemplate  = require('./config.js'),
    getToken        = require('./utilities/token.js'),
    sources         = require('./utilities/sources.js'),
    assets          = require('./utilities/assets.js'),
    whitelistApi    = require('./utilities/whitelist.js'),
    config          = {};

exports.handler = function(event, context) {
    "use strict";
    console.log('REQUEST RECEIVED:\\n', JSON.stringify(event));

    var data = {};
    if (event.hasOwnProperty('detail-type') && event['detail-type'] === 'Scheduled Event') {
        data['record'] = {};
        data['awsAccountId'] = event.account;
        data['awsRegion'] = event.region;
        data['message'] = event;
    } else {
        var record  = event.Records[0],
            message = JSON.parse(event.Records[0].Sns.Message);

        if (!isSupportedEvent(message)) {
            console.log("%s event is not supported", JSON.stringify(event, null, 4));
            return context.succeed();
        }

        if (message.hasOwnProperty('template')) {
            var arn = message.template.split(':');
            data['record'] = {};
            data['awsAccountId'] = arn[4];
            data['awsRegion'] = arn[3];
            data['message'] = message;
        } else {
            var topicArn = record.Sns.TopicArn.split(':');
            data['record'] = record;
            data['message'] = message;
            data['awsAccountId'] = topicArn[4];
            data['awsRegion'] = topicArn[3];
        }
    }
    if (data['awsAccountId'] === null) {
        return context.succeed();
    }

    // Create global config
    console.log("Checks: %s, config: %s", process.env.checks, JSON.stringify(getChecksFromEnvironment(process.env.checks)));
    var deploymentConfig = {
            'accountId': process.env.accountId,
            'api_url': process.env.api_url,
            'checks': getChecksFromEnvironment(process.env.checks)
        };
    console.log("deploymentConfig: %s", JSON.stringify(deploymentConfig, null, 2));

    config = _.merge(configTemplate, deploymentConfig);
    console.log("Configuration: %s", JSON.stringify(config, null, 2));

    var supportedAssetTypesHashtable = getSupportedAssetTypes(config.checks),
        getTokenParams = {
            awsRegion: data.awsRegion,
            secretName: process.env.SecretName,
            identifier: process.env.identifier
        };
    getToken(getTokenParams, function(status, token) {
        if (status !== "SUCCESS") {
            console.error("Unable to retreive token, check your credentials.");
            return context.fail();
        }
        
        // get a list of all environments for this AWS account
        async.waterfall(
            [
                function getSources(callback) {
                    sources.getSources(token, function(status, environments) {
                        console.log("Getting Cloud Insight environments list for '" +
                                      config.accountId + "' account id.");
                        if ( status !== "SUCCESS" ) {
                            return callback("Unable to fetch environments.");
                        } else {
                            return callback(null, environments.sources);
                        }
                    });
                },
                function processMyAccountSources(rows, callback) {
                    console.log("Getting environments for '" + data.awsAccountId +
                                 "' AWS Account. Number of active environments: '" + rows.length + "'.");
                    var deletedEnvironmentId = getDeletedAlertLogicAppliance(config.accountId, data.message);
                    if (deletedEnvironmentId) {
                        /*
                         * This is a delete instance event for Alert Logic's security appliance for our account.
                        */
                        var params          = {
                            "token":            token,
                            "config":           config,
                            "accountId":        config.accountId,
                            "environmentId":    deletedEnvironmentId,
                            "workerFunctionName": process.env.workerFunctionName,
                            "record":           record,
                            "awsRegion":        data.awsRegion,
                            "eventType":        getEventType(data.message),
                            "assetTypes":       supportedAssetTypesHashtable
                        };
                        return processAwsConfigEvent(
                                    params,
                                    data.message,
                                    function(err, result) {
                                        handleCompletionCallback(err, record, context);
                                    });
                    }

                    var sourcesAsync = require('async');
                    sourcesAsync.each(rows, function(row, sourcesAsyncCallback) {
                        var source = row.source,
                            params          = {
                                "token":            token,
                                "config":           config,
                                "accountId":        config.accountId,
                                "environmentId":    source.id,
                                "workerFunctionName": process.env.workerFunctionName,
                                "record":           record,
                                "awsRegion":        data.awsRegion,
                                "eventType":        getEventType(data.message),
                                "assetTypes":       supportedAssetTypesHashtable
                            };

                        /*
                         * Assert that the region is in scope for this environmentId 
                         */
                        console.log("Getting regions in scope for '%s' account and '%s' environment", params.accountId, params.environmentId);
                        assets.getRegionsInScope(token, config.accountId, params.environmentId, function(status, regions) {
                            if (status !== "SUCCESS") {
                                console.error("Unable to retreive regions in scope. Error: " + status);
                                return sourcesAsyncCallback(status);
                            }
                            console.log("'Regions in scope for account: %s and environment: %s - %s", params.accountId, params.environmentId, JSON.stringify(regions));
                            if (!isRegionInScope(params.awsRegion, regions)) {
                                console.log("'%s' region is in not scope for '%s' account and '%s' environment", params.awsRegion, params.accountId, params.environmentId);
                                return sourcesAsyncCallback(null);
                            }
                            console.log("'%s' region is in scope for '%s' environment", params.awsRegion, params.environmentId);

                            if (!source.config.aws.hasOwnProperty('credential') || !source.config.aws.credential.hasOwnProperty('id')) {
                                console.log("No valid credentials found for '%s' environment.", params.environmentId);
                                return sourcesAsyncCallback(null);
                            }

                            sources.getCredential(token, source.config.aws.credential.id,function(status, credential) {
                                if (!credential.credential.hasOwnProperty('iam_role') || !credential.credential.iam_role.hasOwnProperty('arn')) {
                                    console.log("No valid IAM credentials found for '%s' environment.", params.environmentId);
                                    return sourcesAsyncCallback(null);
                                }

                                var sourcesAwsAccountId = credential.credential.iam_role.arn.split(":")[4];
                                if (sourcesAwsAccountId !== data.awsAccountId) {
                                    // Don't do anything for aws accounts other then the current one
                                    console.log("Environment '%s' isn't applicable to '%s' AWS Account", params.environmentId, data.awsAccountId);
                                    return sourcesAsyncCallback(null);
                                }

                                return processAwsConfigEvent(
                                            params,
                                            data.message,
                                            sourcesAsyncCallback);
                                });
                            });
                        },
                        function(err) {
                            if (err) {
                                console.error("Failed to process environments for '%s' accountId. Error: '%s'",
                                              config.accountId, JSON.stringify(err));
                            } else {
                                console.log("Finished processing environments for '%s' accountId",
                                            config.accountId);
                            }
                            callback(err); 
                        }
                    );
                }
            ], function (err) {
                handleCompletionCallback(err, record, context);
            }
        );
    });
};

function processAwsConfigEvent(params, message, callback) {
    "use strict";
    console.log("Processing '%s' environment message.", params.environmentId);

    switch (params.eventType) {
        case 'configurationItem':
            if (!params.assetTypes.hasOwnProperty(message.configurationItem.resourceType)) {
                console.log("'" + message.configurationItem.resourceType + "' resource type is unsupported.");
                return callback(null);
            }

            /*
            * Process single configuration item
            */
            return analyze(params, function(status, result) {
                if (status !== "SUCCESS") {
                    console.log("Failed to analyze configuration item parameters. Params: %s", JSON.stringify(params, null, 2));
                    return callback(status);
                }
                params['message']  = message;
                params['vpcs']      = result.vpcs;
                params['whitelist'] = result.whitelist;
                return callWorker(params, callback);
            });
        case 'configRule':
            if (!params.assetTypes.hasOwnProperty(message.resourceType)) {
                console.log("'" + message.resourceType + "' resource type is unsupported.");
                return callback(null);
            }
            /*
            * Process single configuration item
            */
            return analyze(params, function(status, result) {
                if (status !== "SUCCESS") {
                    return callback(status);
                }
                params['message']  = message;
                params['vpcs']      = result.vpcs;
                params['whitelist'] = result.whitelist;
                return callWorker(params, callback);
            });
           
        case 'snapshotEvent':
            /*
            * Process all configration items in stored in S3 object
            */
            return analyze(params, function(status, result) {
                if (status !== "SUCCESS") {
                    return callback(status);
                }
                params['vpcs']      = result.vpcs;
                params['whitelist'] = result.whitelist;
                console.log("Processing snapshot event. Params:" + JSON.stringify(params));
                return processSnapshot(params, message, callback);
            });

        case 'scheduledEvent':
            return analyze(params, function(status, result) {
                if (status !== "SUCCESS") {
                    return callback(status);
                }
                params['message']  = message;
                params['vpcs']      = result.vpcs;
                params['whitelist'] = result.whitelist;
                return callWorker(params,  callback);
            });

        case 'inspectorEvent':
            return analyze(params, function(status, result) {
                if (status !== "SUCCESS") {
                    return callback(status);
                }
                params['message']  = message;
                params['vpcs']      = result.vpcs;
                params['whitelist'] = result.whitelist;
                return callWorker(params,  callback);
            });


        default: 
            console.log("Attempted to process unsupported record. Event: " + JSON.stringify(params.record));
            return callback(null);
    }
}

function processSnapshot(args, message, resultCallback) {
    "use strict";
    async.waterfall([
        function bucketLocation(callback) {
            var s3 = new AWS.S3({apiVersion: '2006-03-01'});
            s3.getBucketLocation({Bucket: message.s3Bucket}, function(err, data) {
                if (err) {
                    console.error("Failed to get bucket '%s' location while processing snapshot. Error: %s",
                                  message.s3Bucket, JSON.stringify(err));
                    callback(err);
                } else {
                    var bucketLocation  = data.LocationConstraint;
                    console.log("Snapshot bucket location: %s", bucketLocation);
                    callback(null, new AWS.S3({endpoint: getS3Endpoint(bucketLocation), apiVersion: '2006-03-01'}));
                }
            });
        },
        function download(s3, callback) {
            var params      = {
                Bucket: message.s3Bucket,
                Key: message.s3ObjectKey
            };
            console.log("Getting config snapshot. Parameters: %s", JSON.stringify(params));
            s3.getObject({
                Bucket: message.s3Bucket,
                Key: message.s3ObjectKey
            }, function(err, data) {
                callback(err, data);
            });
        },
        function uncompress(response, callback) {
            console.log("Uncompressing config snapshot. Parameters: %s", JSON.stringify(args));
            var data = new Buffer(response.Body);
            zlib.gunzip(data, function(err, decoded) {
                callback(err, decoded && decoded.toString());
            });
        },
        function done(data, callback) {
            console.log("Processing config snapshot. Parameters: " + JSON.stringify(args));
            require('async').each(JSON.parse(data.toString('utf8'), null, 2).configurationItems,
                function (item, itemsCallback) {
                    if (!args.assetTypes.hasOwnProperty(item.resourceType)) {
                        return itemsCallback();
                    }
                    if (item.resourceType === "AWS::EC2::VPC") {
                        console.log("Processing VPC: %s", JSON.stringify(item)); 
                    }
                    args.message = {
                        configurationItem: item
                    };
                    console.log("Calling worker for the snapshotEvent. Args: %s", JSON.stringify(args));
                    callWorker(args, function() {
                        return itemsCallback();
                    });
                },
                function(err) {
                    console.log("Finished processing configuration items");
                    callback(err);
                });
        }
        ],
        function(err) {
            if (err) {
                console.error("Failed to process configuration snapshot. Error: " + JSON.stringify(err));
                resultCallback(err);
            } else {
                console.log("Finished processing snapshot");
                resultCallback(null);
            }
    });
}

function getDeletedAlertLogicAppliance(accountId, message) {
    "use strict";
    if (message &&
        message.hasOwnProperty("configurationItem") &&
        message.configurationItem.hasOwnProperty("resourceType") && 
        message.configurationItem.resourceType === "AWS::EC2::Instance" &&
        message.configurationItem.configurationItemStatus === "ResourceDeleted") {

        var configuration   = message.configurationItemDiff.changedProperties.Configuration.previousValue,
            environmentId   = null;
        for (var i = 0; i < configuration.tags.length; i++) {
            if (configuration.tags[i].key === "AlertLogic-AccountID" && configuration.tags[i].value !== accountId) {
                // This is Alert Logic appliance for our account
                return null;
            }
            if (configuration.tags[i].key === "AlertLogic-EnvironmentID") {
                environmentId = configuration.tags[i].value;
            }
        }
        return environmentId;
    } else {
        return null;
    }
}

function callWorker(args, callback) {
    "use strict";
    AWS.config.update({region: args.awsRegion});
    var lambda  = new AWS.Lambda({apiVersion: '2015-03-31'}),
        payload = JSON.stringify(args),
        params = {
            "FunctionName": args.workerFunctionName,
            "InvocationType": (payload.length < 128000) ? 'Event' : 'RequestResponse',
            "Payload": payload
        };

    console.log("Calling '%s' function for '%s' environment. EventType: '%s'",
                params.FunctionName, args.environmentId, args.eventType);
    lambda.invoke(params, function(err, data) {
        if (err) {
            console.error("Failed to invoke lambda function for '" + args.environmentId +
                          "' environment. " + "Error: " + JSON.stringify(err));
        } else {
            if (data.Status !== 202) {
                console.log("Lambda execution for '" + params.FunctionName +
                             "' returned '" + JSON.stringify(data) + "'.");
            }
        }
        return callback(null);
    });
}

/*
 * Get VPCs in scope and whitelist for the specified environment
 */
function analyze(params, resultCallback) {
    "use strict";
    async.waterfall([
        function(callback) {
            assets.getVpcsInScope(params.token, params.accountId, params.environmentId, params.awsRegion, function(status, vpcs) {
                var result = {};
                if (status === 'SUCCESS') {
                    result['vpcs'] = [];
                    if (vpcs.hasOwnProperty('rows') && vpcs.rows > 0) {
                        result['vpcs'] = vpcs.assets.map(function(vpc) {return vpc[0].vpc_id;});
                    }
                    callback(null, result);
                } else {
                    console.error("Failed to get protected VPCs for '%s' environment in '%s' region. Error: %s",
                                params.environmentId, params.awsRegion, JSON.stringify(status));
                    callback(status);
                }
            });
        },
        function(result, callback) {
            whitelistApi.getWhitelistedTags(params.token, params.accountId, params.environmentId,
                function(status, whitelist) {
                    result['whitelist'] = [];
                    if (status === "SUCCESS") {
                        console.log("Whitelist for %s:%s: %s", params.accountId, params.environmentId, JSON.stringify(whitelist));
                        result['whitelist'] = whitelist;
                        return callback(status, result);
                    } else {
                        console.error("Failed to get whitelist for '%s' environment in '%s' region. Error: %s",
                                    params.environmentId, params.awsRegion, JSON.stringify(status));
                        return callback(status);
                    }
                }
            );
        }
    ], function(err, result) {
        return resultCallback(err, result);
    });
}

function handleCompletionCallback(err, data, context) {
    "use strict";
    if (err) {
        console.error("Failed to process AWS Config Event: " + JSON.stringify(data, null, 2) +
                      ". Error: " + JSON.stringify(err));
        context.fail();
    } else {
        console.log("Successfully dispatched AWS Config Event.");
        context.succeed();
    }
}

function isSupportedEvent(message) {
    "use strict";
    if (message.hasOwnProperty('configurationItem') ||
            (message.hasOwnProperty('messageType') &&
            message.messageType === 'ConfigurationSnapshotDeliveryCompleted')) {
        return true;
    } else if (message.hasOwnProperty('template') && message.template.startsWith('arn:aws:inspector')) {
        return true;
    } else {
        return false;
    }
}

function  getSupportedAssetTypes(checks) {
    "use strict";
    var result = {},
        checkNames = Object.getOwnPropertyNames(checks);

    for (var i = 0; i < checkNames.length; i++) {
        var checkName = checkNames[i],
            checkMode = checks[checkName].hasOwnProperty("mode") ? checks[checkName].mode : "event";

        if (checks[checkName].hasOwnProperty("configuration") &&
            checks[checkName].configuration.hasOwnProperty("resourceTypes")) {

            var resourceTypes = checks[checkName].configuration.resourceTypes;
            for (var l = 0; l < resourceTypes.length; l++) {
                if (!result.hasOwnProperty(resourceTypes[l])) {
                    result[resourceTypes[l]] = checkMode;
                }
            }
        }
    }
    return result;
}

function isRegionInScope(awsRegion, regions) {
    "use strict";
    for (var i = 0; i < regions.rows; i++) {
        if (regions.assets[i][0].region_name === awsRegion) {
            return true;
        }
    }
    return false;
}

function getS3Endpoint(region) {
    "use strict";
    if (region === "" || region === 'us-east-1') {
            return 's3.amazonaws.com';
    }
    return 's3-' + region + '.amazonaws.com';
}

function getEventType(message) {
    "use strict";

    console.log("getting event type: " + JSON.stringify(message));
    if (message.hasOwnProperty('messageType') && message.messageType === 'ConfigurationSnapshotDeliveryCompleted') {
        return 'snapshotEvent';
    }

    if (message.hasOwnProperty('configurationItem') && message.configurationItem.hasOwnProperty('resourceType')) {
        return 'configurationItem';
    }

    if (message.hasOwnProperty('configRuleName')) { 
        return 'configRule';
    }

    if (message.hasOwnProperty('detail-type') && message['detail-type'] === 'Scheduled Event') {
        return 'scheduledEvent';
    }

    if (message.hasOwnProperty('template') && message.template.startsWith('arn:aws:inspector')) {
        return 'inspectorEvent';
    }

    return null;
}

function getChecksFromEnvironment(checks) {
    "use strict";
    var array = checks.split(";"),
        result = {};
    for (var i = 0; i < array.length - 1; i++) {
        result[array[i]] = {'enabled': true};
    }
    return result;
}
