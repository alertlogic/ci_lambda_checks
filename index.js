require('aws-sdk');
require('zlib');
var async         = require('async'),
    config        = require('./config.js'),
    publishResult = require('./utilities/publish.js');
exports.handler   = function(event, context) {
    "use strict";
    console.log('Received event:', JSON.stringify(event, null, 2));
    var getToken = require('./utilities/token.js');

    getToken(function(status, token) {
        if (status === "SUCCESS") {
            async.each(config.checks, function (check, callback) {
                if (check.enabled === true) {
                    console.log("Check '" + check.name.toString() + "' is enabled.");
                    var test = require('./checks/' + check.name.toString() + '.js');
                    try {
                        var result = test(JSON.parse(event.Records[0].Sns.Message));
                        if ( result !== null ) {
                            if (result.vulnerable === true) {
                                // Publish a result against the available metadata
                                publishResult(token, result.metadata, check.vulnerability, callback);
                            } else {
                                // Clear a result against the available metadata
                                publishResult(token, [], check.vulnerability, callback);
                            }
                        }
                    } catch (e) {
                        console.log("Check '" + check.name.toString() + "' threw an exception.\nError: " + e.message + "\nStack: " + e.stack);
                    }
                } else {
                    console.log("Check '" + check.name.toString() + "' is disabled.");
                }
                callback();
            });
        } else {
            console.log("Unable to retreive token, check your credentials.");
        }
        /*
        * Succeed regardless of any check status to clear the message
        */
        console.log("Execution completed");
        context.succeed();
    });
};
