var async               = require('async');

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
                    logger("Failed to create '" + setupData.lambda.functionName + "' lambda function."
                                + " Error: " + JSON.stringify(err));
                    return resultCallback(err);
            }
        } else {
            logger("Successfully created '" + setupData.lambda.functionName + "' lambda function. "
                        + "Arn: " + data.FunctionArn);
            setupData.lambda.functionArn = data.FunctionArn;
            return resultCallback(null, setupData);
        }
    });
};

function uploadLambdaCode(lambda, setupData, resultCallback) {
    var params = {
            FunctionName:   setupData.lambda.functionName, 
            ZipFile:        setupData.lambda.zipFile 
        },
        logger  = setupData.logger;
    
    lambda.updateFunctionCode(params, function(err, data) {
        if (err) {
            logger("Failed to update function code for '" + setupData.lambda.functionName + "' lambda function."
                        + " Error: " + JSON.stringify(err));
            return resultCallback(err);
        } else {
            logger("Successfully uploaded '" + setupData.lambda.functionName + "' lambda function code. "
                        + "Arn: " + data.FunctionArn);
            setupData.lambda.functionArn = data.FunctionArn;
            return resultCallback(null, setupData);
        }
    });
}

module.exports = {
    createFunction: setupLambda
};
