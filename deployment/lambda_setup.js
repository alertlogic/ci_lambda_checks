var setupLambda = function(setupData, resultCallback) {
    "use strict";
    var AWS     = setupData.aws,
        logger  = setupData.logger;
    AWS.config.update({region: setupData.setupRegion});

    var lambda = new AWS.Lambda({apiVersion: '2015-03-31'}),
        params = {
            Code: {
                ZipFile:    setupData.lambda.zipFile
            },
            FunctionName:   setupData.lambda.functionName,
            Handler:        setupData.lambda.handler,
            Role:           setupData.lambda.roleArn,
            Runtime:        setupData.lambda.runtime,
            Timeout:        setupData.lambda.timeout 
        };
    lambda.createFunction(params, function(err, data) {
        if (err) {
            switch(err.statusCode) {
                case 409:
                    /*
                     * Function already exists... lets just upload code
                     */
                    return uploadLambdaCode(lambda, setupData, resultCallback);
                default:
                    logger("Failed to create '" + setupData.lambda.functionName + "' lambda function." +
                            " Error: " + JSON.stringify(err));
                    return resultCallback(err);
            }
        } else {
            logger("Successfully created '" + setupData.lambda.functionName + "' lambda function. " +
                    "Arn: " + data.FunctionArn);
            setupData.lambda.functionArn = data.FunctionArn;
            return resultCallback(null, setupData);
        }
    });
};

var enableSnsPublishing = function(setupData, resultCallback) {
    "use strict";
    var AWS     = setupData.aws;
    AWS.config.update({region: setupData.setupRegion});

    var params = {
            Action:         "lambda:invokeFunction",
            FunctionName:   setupData.lambda.functionName,
            Principal:      "sns.amazonaws.com",
            StatementId:    statementIdFromArn(setupData.deliveryChannels[0].snsTopicARN),
            SourceArn:      setupData.deliveryChannels[0].snsTopicARN
        },
        logger  = setupData.logger,
        lambda = new AWS.Lambda({apiVersion: '2015-03-31'});

    lambda.addPermission(params, function(err, data) {
        if (err) {
            if (err.statusCode === 409) {
                logger("Permission to receive SNS notifications by '" + setupData.lambda.functionName + "' lambda function already exists.");
                return resultCallback(null, setupData);
            } else {
                logger("Failed to add permission to receive SNS notifications to '" + setupData.lambda.functionName + "' lambda function." +
                        " Error: " + JSON.stringify(err));
                return resultCallback(err);
            }
        } else {
            logger("Successfully added permission to receive SNS notifications to '" + setupData.lambda.functionName + "' lambda function code.");
            return resultCallback(null, setupData);
        }
    });
};

function uploadLambdaCode(lambda, setupData, resultCallback) {
    "use strict";
    var params = {
            FunctionName:   setupData.lambda.functionName, 
            ZipFile:        setupData.lambda.zipFile 
        },
        logger  = setupData.logger;
    
    lambda.updateFunctionCode(params, function(err, data) {
        if (err) {
            logger("Failed to update function code for '" + setupData.lambda.functionName + "' lambda function." +
                    " Error: " + JSON.stringify(err));
            return resultCallback(err);
        } else {
            setupData.lambda.functionArn = data.FunctionArn;
            logger("Successfully uploaded '" + setupData.lambda.functionName + "' lambda function code. " +
                   "Arn: " + setupData.lambda.functionArn);
            return resultCallback(null, setupData);
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
