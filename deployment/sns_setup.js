var async               = require('async'),
    defaultTopicName    = 'config-topic';

var getSNSTopic = function(setupData, resultCallback) {
    "use strict";
    /*
     * if the topic already exists then do nothing, otherwise create new topic
     */
    if (setupData.region === setupData.setupRegion &&
        setupData.deliveryChannels.length &&
        setupData.deliveryChannels[0].hasOwnProperty("snsTopicARN") &&
        setupData.deliveryChannels[0].snsTopicARN.length) {
        validateTopic(setupData, resultCallback);
    } else {
        createTopic(setupData, resultCallback);
    }
};

function validateTopic(setupData, callback) {
    "use strict";
    var AWS     = setupData.aws,
        logger  = setupData.logger;

    AWS.config.update({region: setupData.setupRegion});
    
    var sns         = new AWS.SNS({apiVersion: '2010-03-31'}),
        topicArn    = setupData.deliveryChannels[0].snsTopicARN;

    sns.getTopicAttributes({TopicArn: topicArn}, function(err, data) {
        if (err) {
            logger("getTopicAttributes failed for '" + topicArn + "'. Error: " + err);
            return callback(err);
        } else {
            logger("Confirmed that SNS topic '" + topicArn + "' exists.");
            return callback(null, setupData);
        }
    });
}

function createTopic(setupData, callback) {
    "use strict";
    var AWS     = setupData.aws,
        logger  = setupData.logger;

    AWS.config.update({region: setupData.setupRegion});

    var sns         = new AWS.SNS({apiVersion: '2010-03-31'});
    
    sns.createTopic({Name: defaultTopicName}, function(err, data) {
        if (err) {  
            logger("createTopic failed for '" + defaultTopicName + "'. Error: " + err);
            return callback(err);
        } else {
            setupData.deliveryChannels[0].snsTopicARN = data.TopicArn;
            logger("Successfully created '" + data.TopicArn + "' topic.");
            return callback(null, setupData);
        }
    });
}

function subscribe(setupData, resultCallback) {
    "use strict";
    var AWS     = setupData.aws,
        logger  = setupData.logger;
    AWS.config.update({region: setupData.setupRegion});
    
    var sns         = new AWS.SNS({apiVersion: '2010-03-31'});

    async.each(setupData.lambda,
        function(lambdaSetup, callback) {
            if (!lambdaSetup.hasOwnProperty("subscribe") || !lambdaSetup.subscribe) {
                return callback();
            }
            subscribeLambdaFunction(lambdaSetup, setupData.deliveryChannels[0].snsTopicARN, sns, logger, callback);
        },
        function(err) {
            return resultCallback(err, setupData);
        }
    );
}

function subscribeLambdaFunction(lambdaSetup, snsTopicArn, sns, logger, callback) {
    "use strict";
    var params = {
            Protocol: "lambda", 
            TopicArn: snsTopicArn,
            Endpoint: lambdaSetup.functionArn
        };

    sns.subscribe(params, function(err, data) {
        if (err) {
            logger("Failed to subscribe lambda function '" + params.Endpoint +
                    "' to topic '" + params.TopicArn + "'. Error: " + JSON.stringify(err));
            return callback(err);
        } else {
            logger("Successfully subscribed lambda function '" + params.Endpoint +
                    "' to topic '" + params.TopicArn + "'.");
            return callback(null);
        }
    });
}

module.exports = {
    getTopic: getSNSTopic,
    createLambdaSubscription: subscribe
};

