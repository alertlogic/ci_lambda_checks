require('zlib');
var async           = require('async'),
    AWS             = require('aws-sdk'),
    zlib            = require('zlib'),
    config          = require('./config.js'),
    getToken        = require('./utilities/token.js'),
    sources         = require('./utilities/sources.js'),
    assets          = require('./utilities/assets.js'),
    whitelistApi    = require('./utilities/whitelist.js');

exports.handler = function(event, context) {
    "use strict";

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
            var subject = record.Sns.Subject;
            data['record'] = record;
            data['message'] = message;
            data['awsAccountId'] = getAccountIdFromSubject(subject);
            data['awsRegion'] = getAwsRegionFromSubject(subject);
        }
    }

    var supportedAssetTypesHashtable = getSupportedAssetTypes(config.checks);

    getToken(function(status, token) {
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
                                 "'. Number of active environments: '" + rows.length + "'.");
                    var deletedEnvironmentId = getDeletedAlertLogicAppliance(config.accountId, data.message);
                    if (deletedEnvironmentId) {
                        // This is a delete instance event for Alert Logic's security appliance for our account.
                        var params          = {
                            "token":            token,
                            "accountId":        config.accountId,
                            "environmentId":    deletedEnvironmentId,
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
                        var source = row.source;
                        if (!source.config.hasOwnProperty('aws') ||
                            !source.config.aws.hasOwnProperty('credential') ||
                            !source.config.aws.credential.hasOwnProperty('id')) {
                            return sourcesAsyncCallback(null);
                        }

                        sources.getCredential(token, source.config.aws.credential.id,function(status, credential) {
                            if (!credential.credential.hasOwnProperty('iam_role') || !credential.credential.iam_role.hasOwnProperty('arn')) {
                                return sourcesAsyncCallback(null);
                            }

                            var sourcesAwsAccountId = credential.credential.iam_role.arn.split(":")[4];
                            if (sourcesAwsAccountId !== data.awsAccountId) {
                                // Don't do anything for aws accounts other then the current one
                                return sourcesAsyncCallback(null);
                            }

                            var params          = {
                                    "token":            token,
                                    "accountId":        config.accountId,
                                    "environmentId":    source.id,
                                    "record":           record,
                                    "awsRegion":        data.awsRegion,
                                    "eventType":        getEventType(data.message),
                                    "assetTypes":       supportedAssetTypesHashtable
                                };

                            return processAwsConfigEvent(
                                        params,
                                        data.message,
                                        sourcesAsyncCallback);
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
    console.log("Processing '%s' message.", params.environmentId);
    assets.getRegionsInScope(params.token, params.environmentId, function(status, regions) {
        if (status !== "SUCCESS") {
            console.error("Unable to retreive regions in scope. Error: " + status);
            return callback(status);
        }
        if (!isRegionInScope(params.awsRegion, regions)) {
            console.log("'" + params.awsRegion + "' region is not in scope for '" +
                        config.environmentId + "' environment.");
            return callback(null);
        }

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
    });
}

function processSnapshot(args, message, resultCallback) {
    "use strict";
    async.waterfall([
        function bucketLocation(callback) {
            var s3 = new AWS.S3({apiVersion: '2006-03-01'});
            s3.getBucketLocation({Bucket: message.s3Bucket}, function(err, data) {
                if (err) {
                    console.error("Failed to get bucket location while processing snapshot. "+
                                  "Error: " + JSON.stringify(err));
                    callback(err);
                } else {
                    var bucketLocation  = data.LocationConstraint;
                    console.log("Snapshot bucket location: " + bucketLocation);
                    callback(null, new AWS.S3({endpoint: getS3Endpoint(bucketLocation), apiVersion: '2006-03-01'}));
                }
            });
        },
        function download(s3, callback) {
            var params      = {
                Bucket: message.s3Bucket,
                Key: message.s3ObjectKey
            };
            console.log("Getting config snapshot. Parameters: " + JSON.stringify(params));
            s3.getObject({
                Bucket: message.s3Bucket,
                Key: message.s3ObjectKey
            }, function(err, data) {
                callback(err, data);
            });
        },
        function uncompress(response, callback) {
            var data = new Buffer(response.Body);
            zlib.gunzip(data, function(err, decoded) {
                callback(err, decoded && decoded.toString());
            });
        },
        function done(data, callback) {
            require('async').each(JSON.parse(data.toString('utf8'), null, 2).configurationItems,
                function (item, itemsCallback) {
                    
                    if (!args.assetTypes.hasOwnProperty(item.resourceType)) {
                        return itemsCallback();
                    }
                    args.message = {
                        configurationItem: item
                    };
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
            "FunctionName": "ci_checks_worker_" + args.accountId,
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
            assets.getVpcsInScope(params.token, params.environmentId, params.awsRegion, function(status, vpcs) {
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
        if (regions.assets[i][0].name === awsRegion) {
            return true;
        }
    } 
    return false;
}

function getAccountIdFromSubject(subject) {
    "use strict";
    return subject.match(/Account (\d{12})$/)[1];
}

function getAwsRegionFromSubject(subject) {
    "use strict";
    return subject.match(/^\[AWS Config:(.*?)\]/)[1];
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
