require('aws-sdk');
require('zlib');
var async           = require('async'),
    aws             = require('aws-sdk'),
    zlib            = require('zlib'),
    config          = require('./config.js'),
    pkg             = require('./package.json'),
    assets          = require('./utilities/assets.js'),
    getToken        = require('./utilities/token.js'),
    publishResult   = require('./utilities/publish.js');

exports.handler = function(event, context) {
    "use strict";
    console.log('Received event:', JSON.stringify(event, null, 2));

    var rawMessage = JSON.parse(event.Records[0].Sns.Message);
    getToken(function(status, token) {
        if (status === "SUCCESS") {
            console.log("Successfully obtained token from the CloudInsight");
            if (rawMessage.hasOwnProperty('configurationItem') &&
                rawMessage.configurationItem.hasOwnProperty('resourceType')) {
                /*
                * Process single configuration item
                */
                analyze(token, rawMessage.configurationItem.awsRegion, function(status, vpcs) { 
                    processConfigurationItem(
                        token,
                        vpcs,
                        rawMessage,
                        function(err) {
                            return contextCallback(err, context);
                    });
                });
            } else if (rawMessage.hasOwnProperty('messageType') &&
                       rawMessage.messageType === 'ConfigurationSnapshotDeliveryCompleted') {
                /*
                * Process all configration items in stored in S3 object
                */
                var awsRegion = getAwsRegionFromArn(event.Records[0].Sns.TopicArn);
                console.log("Starting full snapshot processing for '" + awsRegion + "'.");
                analyze(token, awsRegion, function(status, vpcs) { 
                    processPeriodicSnapshot(
                        token,
                        awsRegion,
                        vpcs,
                        rawMessage,
                        function(err) {
                            return contextCallback(err, context);
                    });
                }); 
            } else {
                return context.succeed();
            }
        } else {
            console.log("Unable to retreive token, check your credentials.");
            return context.fail();
        }
    });
};

function analyze(token, awsRegion, callback) {
    "use strict";
    assets.getVpcsInScope(token, config.environmentId, awsRegion, function(status, vpcs) {
        if (status === 'SUCCESS') {
            var result = [];
            if (vpcs.hasOwnProperty('rows') && vpcs.rows > 0) {
                result = vpcs.assets.map(function(vpc) {return vpc[0].vpc_id;});
            }
            callback(status, result);
        } else {
            callback(status);
        }
    });
}

function processPeriodicSnapshot(token, awsRegion, vpcs, rawMessage, resultCallback) {
    "use strict";
    async.waterfall([
        function bucketLocation(callback) {
            var s3 = new aws.S3({apiVersion: '2006-03-01'});
            s3.getBucketLocation({Bucket: rawMessage.s3Bucket}, function(err, data) {
                if (err) {
                    console.error("Failed to get bucket location. Error: " + JSON.stringify(err));
                    callback(err);
                } else {
                    var bucketLocation  = data.LocationConstraint;
                    console.error("Snapshot bucket location: " + bucketLocation);
                    callback(null, new aws.S3({endpoint: getS3Endpoint(bucketLocation), apiVersion: '2006-03-01'}));
                }
            });
        },
        function download(s3, callback) {
            var params      = {
                Bucket: rawMessage.s3Bucket,
                Key: rawMessage.s3ObjectKey
            };
            console.log("Getting config snapshot. Parameters: " + JSON.stringify(params));
            s3.getObject({
                Bucket: rawMessage.s3Bucket,
                Key: rawMessage.s3ObjectKey
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
                    var rawMessage = {
                        configurationItem: item
                    };
                    processConfigurationItem(
                        token,
                        vpcs,
                        rawMessage,
                        function() {
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

function processConfigurationItem(token, vpcs, rawMessage, completeCallback) {
    "use strict";
    var awsRegion       = rawMessage.configurationItem.awsRegion,
        resourceType    = rawMessage.configurationItem.resourceType,
        resourceId      = rawMessage.configurationItem.resourceId,
        relationships   = rawMessage.configurationItem.relationships,
        vpcId           = null,
        inScope         = true;

    if (resourceType === "AWS::EC2::VPC") {
        vpcId = resourceId;
    } else {
        for (var i = 0; i < relationships.length; i++) {
            if (relationships[i].resourceType === "AWS::EC2::VPC" &&
                relationships[i].name === "Is contained in Vpc") {
                vpcId = relationships[i].resourceId;
                break;
            }
        }
    }
        
    // Tell checks if the vpc in scope.
    if (vpcId && vpcs.indexOf(vpcId) === -1) {
        inScope = false;
    }
    console.log("Resource inScope: '" + inScope + "'. ResourceType: '" + resourceType +
                "', ResourceId: '" + resourceId +
                "', VPC: '" + vpcId + "'. VPCs in scope: '" + vpcs.toString() + "'.");

    async.each(config.checks, function (check, callback) {
        if (check.enabled === true) {

            if (!isCheckNameValid(check.name.toString())) {
                console.log("Invalid check name. Use only alphanumeric values. Check name: " + check.name.toString());
                callback();
                return;
            }
            console.log("Check '" + check.name.toString() + "' is enabled.");

            //
            // Don't do anything if the check isn't applicable to the event's resourceType
            //
            if (-1 === check.configuration.resourceTypes.indexOf(resourceType)) {
                console.log("Skipping execution of the check '" + check.name.toString() + "'\n" +
                            "event's resourceType: '" + resourceType + "'\n" + "supported resourceTypes: '" +
                            check.configuration.resourceTypes.toString() + "'");
                callback();
                return;
            }

            try {
                var test = require('./checks/' + check.name.toString() + '.js'),
                    metadata = getMetadata(check.name.toString(), awsRegion, resourceType, resourceId);
                console.log("Executing custom check. CheckName: " + check.name.toString() + ", resourceType: " + resourceType + ", resourceId: " + resourceId);
                if (test(inScope, rawMessage) === true) {
                    // Publish a result against the available metadata
                    publishResult(token, metadata, [check.vulnerability], callback);
                } else {
                    // Clear a result against the available metadata
                    publishResult(token, metadata, [], callback);
                }
            } catch (e) {
                console.log("Check '" + check.name.toString() + "' threw an exception.\nError: " +
                            e.message + "\nStack: " + e.stack);
                callback();
            }
        } else {
            console.log("Check '" + check.name.toString() + "' is disabled.");
            callback();
        }
    },
    function(err){
        console.log("Execution completed");
        completeCallback();
    });
}

function contextCallback(err, context) {
    "use strict";
    if (err) {
        return context.fail();
    } else {
        return context.succeed();
    }
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

function isCheckNameValid(checkName) {
    "use strict";
    return (null != checkName.match("^[a-zA-Z0-9]*$"));
}

function getAwsRegionFromArn(arn) {
    "use strict";
    var regionIndex = 3,
        awsRegion   = arn.split(":")[regionIndex];
    console.log("Region: " + awsRegion);
    return awsRegion;
}

function getS3Endpoint(region) {
    "use strict";
    if (region === "" || region === 'us-east-1') {
            return 's3.amazonaws.com';
    }
    return 's3-' + region + '.amazonaws.com';
}
