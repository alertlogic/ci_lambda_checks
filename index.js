require('aws-sdk');
require('zlib');
var async         = require('async'),
    config        = require('./config.js'),
    getAssetKey   = require('./utilities/assets.js'),
    publishResult = require('./utilities/publish.js');

exports.handler   = function(event, context) {
    "use strict";
    console.log('Received event:', JSON.stringify(event, null, 2));

    var rawMessage = JSON.parse(event.Records[0].Sns.Message);
    if (!rawMessage.hasOwnProperty('configurationItem') || 
        !rawMessage.configurationItem.hasOwnProperty('resourceType')) {
        context.succeed();
        return;
    }

    var getToken = require('./utilities/token.js'),
        awsRegion = rawMessage.configurationItem.awsRegion,
        resourceType = rawMessage.configurationItem.resourceType,
        resourceId = rawMessage.configurationItem.resourceId;

    getToken(function(status, token) {
        if (status === "SUCCESS") {
            async.each(config.checks, function (check, callback) {
                if (check.enabled === true) {
                    
                    if (!isCheckNameValid(check.name.toString())) {
                        console.log("Invalid check name. Use only alphanumeric values. Check name: " + check.name.toString());
                        callback();
                        return;
                    }

                    console.log("Check '" + check.name.toString() + "' is enabled.");
                    var test = require('./checks/' + check.name.toString() + '.js');
                    
                    //
                    // Don't do anything if the check isn't applicable to the event's resourceType
                    //
                    if (-1 === check.configuration.resourceTypes.indexOf(resourceType)) {
                        callback();
                        return;
                    }

                    try {
                        var metadata = getMetadata(check.name.toString(), awsRegion, resourceType, resourceId);
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
                context.succeed();
            });
        } else {
            console.log("Unable to retreive token, check your credentials.");
            context.succeed();
        }
    });
};

function getMetadata(checkName, awsRegion, resourceType, resourceId) {
    "use strict";
    return {
        scanner: "custom",
        scanner_scope: "custom" + checkName,
        timestamp: Math.round(+new Date()/1000),
        asset_id: getAssetKey(awsRegion, resourceType, resourceId),
        environment_id: config.environmentId,
        scan_policy_snapshot_id: "custom_snapshot_" + checkName + "_v0.0.3",
        content_type: "application/json" 
    };
}

function isCheckNameValid(checkName) {
    "use strict";
    return (null != checkName.match("^[a-zA-Z0-9]*$"));
}
