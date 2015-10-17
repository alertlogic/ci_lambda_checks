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
            logger(setupData.setupRegion + ": "
                        + "getTopicAttributes failed for '" + topicArn + "'. Error: " + err);
            return callback(err);
        } else {
            logger(setupData.setupRegion + ": "
                        + "Confirmed that SNS topic '" + topicArn + "' exists.");
            return callback(null, setupData);
        }
    });
};

function createTopic(setupData, callback) {
    "use strict";
    var AWS     = setupData.aws,
        logger  = setupData.logger;

    AWS.config.update({region: setupData.setupRegion});

    var sns         = new AWS.SNS({apiVersion: '2010-03-31'});
    
    sns.createTopic({Name: defaultTopicName}, function(err, data) {
        if (err) {  
            logger(setupData.setupRegion + ": "
                        + "createTopic failed for '" + defaultTopicName + "'. Error: " + err);
            return callback(err);
        } else {
            setupData.deliveryChannels[0].snsTopicARN = data.TopicArn;
            logger(setupData.setupRegion + ": "
                        + "Successfully created '" + data.TopicArn + "' topic.");
            return callback(null, setupData);
        }
    });
}

function subscribe(setupData, callback) {
    "use strict";
    var AWS     = setupData.aws,
        logger  = setupData.logger;
    AWS.config.update({region: setupData.setupRegion});
    
    var sns         = new AWS.SNS({apiVersion: '2010-03-31'}),
        params = {
            Protocol: "lambda", 
            TopicArn: setupData.deliveryChannels[0].snsTopicARN,
            Endpoint: setupData.lambda.functionArn
        };

    sns.subscribe(params, function(err, data) {
        if (err) {
            logger(setupData.setupRegion + ": "
                        + "Failed to subscribe lambda function '" + params.Endpoint
                        + "' to topic '" + params.TopicArn + "'. Error: " + JSON.stringify(err));
            return callback(err);
        } else {
            logger(setupData.setupRegion + ": "
                        + "Successfully subscribed lambda function '" + params.Endpoint
                        + "' to topic '" + params.TopicArn + "'.");
            return callback(null, setupData);
        }
    });
}

module.exports = {
    getTopic: getSNSTopic,
    createLambdaSubscription: subscribe
};

