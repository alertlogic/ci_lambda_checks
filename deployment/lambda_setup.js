var async           = require('async');

var setupLambda = function(setupData, resultCallback) {
    "use strict";
    var AWS     = setupData.aws,
        logger  = setupData.logger;
    AWS.config.update({region: setupData.setupRegion});
    var lambda = new AWS.Lambda({apiVersion: '2015-03-31'});

    // Create driver and worker functions
    async.map(setupData.lambda,
        function(lambaSetup, callback) {
            deployLambdaFunction(lambaSetup, lambda, logger, callback);
        },
        function(err, results) {
            setupData.lambda = results;
            return resultCallback(err, setupData);
    });
};

var enableSnsPublishing = function(setupData, resultCallback) {
    "use strict";
    var AWS     = setupData.aws,
        logger  = setupData.logger;
    AWS.config.update({region: setupData.setupRegion});

    var lambda = new AWS.Lambda({apiVersion: '2015-03-31'});

    async.each(setupData.lambda,
        function(lambdaSetup, callback) {
            if (!lambdaSetup.hasOwnProperty("subscribe") || !lambdaSetup.subscribe) {
                return callback();
            }
            addSnsPermission(lambdaSetup, setupData.deliveryChannels[0].snsTopicARN, lambda, logger, callback);
        },
        function(err) {
            resultCallback(err, setupData);
        }
    );
};

function deployLambdaFunction(lambdaSetup, lambda, logger, resultCallback) {
    "use strict";

    var params = {
            Code: {
                ZipFile:    lambdaSetup.zipFile
            },
            FunctionName:   lambdaSetup.functionName,
            Description:    lambdaSetup.description,
            Handler:        lambdaSetup.handler,
            Role:           lambdaSetup.roleArn,
            Runtime:        lambdaSetup.runtime,
            Timeout:        lambdaSetup.timeout
        },
        count = 0;

    logger("Creating lambda function. FunctionName: '" + params.FunctionName + "', Role: '" + params.Role + "'.");
    lambdaSetup.functionArn = null;
    async.doDuring(
        function(callback) {
            lambda.createFunction(params, function(err, data) {
                if (err) {
                    switch(err.statusCode) {
                        case 409:
                            /*
                             * Function already exists... lets just upload code
                             */
                            return uploadLambdaCode(lambdaSetup.functionName, lambdaSetup.zipFile, lambda, logger, function(err, result) {
                                if (err) {return callback(err);}
                                lambdaSetup.functionArn = result;
                                return callback();
                            });
                        case 400:
                            if (err.code === "InvalidParameterValueException") {
                                count++;
                                return setTimeout(callback, 1000);
                            }
                            return callback(err);
                        default:
                            logger("Failed to create '" + lambdaSetup.functionName + "' lambda function." +
                                    " Error: " + JSON.stringify(err));
                            return callback(err);
                    }
                } else {
                    logger("Successfully created '" + lambdaSetup.functionName + "' lambda function. " +
                            "Arn: " + data.FunctionArn);
                    lambdaSetup.functionArn = data.FunctionArn;
                    return callback();
                }
            });
        },
        function(callback) {
            return callback(null, (!lambdaSetup.functionArn || count >= 5));
        },
        function(err) {
            if (err) {return resultCallback(err);}
            return resultCallback(null, lambdaSetup);
            
        }
    );
}

function uploadLambdaCode(functionName, zipFile, lambda, logger, callback) {
    "use strict";
    var params = {
            FunctionName:   functionName,
            ZipFile:        zipFile
        };

    lambda.updateFunctionCode(params, function(err, data) {
        if (err) {
            logger("Failed to update function code for '" + functionName + "' lambda function." +
                    " Error: " + JSON.stringify(err));
            return callback(err);
        } else {
            logger("Successfully uploaded '" + functionName + "' lambda function code. " +
                   "Arn: " + data.FunctionArn);
            return callback(null, data.FunctionArn);
        }
    });
}

function addSnsPermission(lambdaSetup, snsTopicArn, lambda, logger, callback) {
    "use strict";
    var params = {
            Action:         "lambda:invokeFunction",
            FunctionName:   lambdaSetup.functionName,
            Principal:      "sns.amazonaws.com",
            StatementId:    statementIdFromArn(snsTopicArn),
            SourceArn:      snsTopicArn
        };

    lambda.addPermission(params, function(err, data) {
        if (err) {
            if (err.statusCode === 409) {
                logger("Permission to receive SNS notifications by '" + lambdaSetup.functionName + "' lambda function already exists.");
                return callback();
            } else {
                logger("Failed to add permission to receive SNS notifications to '" + lambdaSetup.functionName +
                       "' lambda function. Error: " + JSON.stringify(err));
                return callback(err);
            }
        } else {
            logger("Successfully added permission to receive SNS notifications to '" + lambdaSetup.functionName +
                   "' lambda function code.");
            return callback();
        }
    });
}

function statementIdFromArn(snsTopicArn) {
    "use strict";
    var parsedTopicArn = snsTopicArn.match(/arn:aws:(.*):(.*):(.*):(.*)/);
    return parsedTopicArn[1] + "-" + parsedTopicArn[2] + "-" + parsedTopicArn[3] + "-" + parsedTopicArn[4];
}

module.exports = {
    createFunction: setupLambda,
    enableSnsPublishing: enableSnsPublishing
};
