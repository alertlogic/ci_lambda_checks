require('aws-sdk');
require('zlib');
var async           = require('async'),
    aws             = require('aws-sdk'),
    zlib            = require('zlib'),
    config          = require('./config.js'),
    pkg             = require('./package.json'),
    getAssetKey     = require('./utilities/assets.js'),
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
                * Process all configration items in stored in S3 object
                */
                processConfigurationItem(
                    token,
                    function() {
                        return context.succeed();
                    },
                    rawMessage);

            } else if (rawMessage.hasOwnProperty('messageType') &&
                       rawMessage.messageType === 'ConfigurationSnapshotDeliveryCompleted') {
                /*
                * Process all configration items in stored in S3 object
                */
                console.log("Starting full snapshot processing");
                processPeriodicSnapshot(token, context, rawMessage, getAwsRegionFromArn(event.Records[0].Sns.TopicArn));
            }
        } else {
            console.log("Unable to retreive token, check your credentials.");
            return context.fail();
        }
    });
};

function processPeriodicSnapshot(token, context, rawMessage, awsRegion) {
    "use strict";
    var s3Endpoint  = getS3Endpoint('us-east-1'),
        s3          = new aws.S3({endpoint: s3Endpoint, apiVersion: '2006-03-01'}),
        params      = {
            Bucket: rawMessage.s3Bucket,
            Key: rawMessage.s3ObjectKey
        },
        s3Async = require('async');
    console.log("Getting config snapshot from '" + s3Endpoint + "'. " + JSON.stringify(params));
    s3Async.waterfall([
        function download(callback) {
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
        function done(data, next) {
            require('async').each(JSON.parse(data.toString('utf8'), null, 2).configurationItems,
                function (item, callback) {
                    var rawMessage = {
                        configurationItem: item
                    };
                    processConfigurationItem(
                        token,
                        function() {
                            return callback();
                        },
                        rawMessage);
                },
                function(err) {
                    console.log("Finished processing configuration items");
                    context.succeed();
                });
        }
        ], function(err) {
            if (err) {
                console.log("Error: " + err);
            } else {
                console.log("Finished processing snapshot");
            }
        });
}

function processConfigurationItem(token, completeCallback, rawMessage) {
    "use strict";
    var awsRegion = rawMessage.configurationItem.awsRegion,
        resourceType = rawMessage.configurationItem.resourceType,
        resourceId = rawMessage.configurationItem.resourceId;

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
                console.log(
                    "Skipping execution of the the check '" + check.name.toString() + "'\n" + "event's resourceType: '" + resourceType + "'\n" + "supported resourceTypes: '" + check.configuration.resourceTypes.toString() + "'");
                callback();
                return;
            }

            try {
                var test = require('./checks/' + check.name.toString() + '.js'),
                    metadata = getMetadata(check.name.toString(), awsRegion, resourceType, resourceId);
                if (test(rawMessage) === true) {
                    // Publish a result against the available metadata
                    publishResult(token, metadata, [check.vulnerability], callback);
                } else {
                    // Clear a result against the available metadata
                    publishResult(token, metadata, [], callback);
                }
            } catch (e) {
                console.log("Check '" + check.name.toString() + "' threw an exception.\nError: " + e.message + "\nStack: " + e.stack);
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

function getMetadata(checkName, awsRegion, resourceType, resourceId) {
    "use strict";
    return {
        scanner: "custom",
        scanner_scope: "custom" + checkName.toLowerCase(),
        timestamp: Math.round(+new Date()/1000),
        asset_id: getAssetKey(awsRegion, resourceType, resourceId),
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
    if (region === 'us-east-1') {
            return 's3.amazonaws.com';
    }
    return 's3-' + region + '.amazonaws.com';
}
