require('aws-sdk');
require('zlib');
//var async = require('async');

/*
 * Load configuration from config.js
 */
var config      = require('./config.js'),
    publish     = require('./utilities/publish.js');
exports.handler = function(event, context) {
    "use strict";
    console.log('Received event:', JSON.stringify(event, null, 2));
    var getToken = require('./utilities/token.js');

    getToken(function(status, token) {
        if (status === "SUCCESS") {
            for ( var check in config.checks ) {
                if (config.checks[check].enabled === true) {
                    var test = require('./checks/' + check.toString() + '.js');
                    try {
                        var result = test(JSON.parse(event.Records[0].Sns.Message));
                        if ( result !== null ) {
                            if (result.vulnerable === true) {
                                publish(token, result.metadata, config.checks[check].vulnerability);
                            } else {
                                publish(token, [], config.checks[check].vulnerability);
                            }
                        }
                    } catch (e) {
                        console.log("Check '" + check.toString() + "' threw an exception.\nError: " + e.message + "\nStack: " + e.stack);
                    }
                }
            }
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
