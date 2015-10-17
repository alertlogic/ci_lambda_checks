/*
 * Discover valid AWS Config that was setup in any region
 * Return recorders and delivery channels for that region
 */
function discoverAwsConfigRecorder(setupData, resultCallback) {
    "use strict";
    var AWS     = setupData.aws,
        async   = require('async'),
        logger = setupData.logger;

    async.doWhilst(
        function (callback) {
            AWS.config.update({region: setupData.region});

            var awsConfig       = new AWS.ConfigService();
            awsConfig.describeConfigurationRecorders(function(err, data) {
                if (err) {
                    callback(err);
                } else {
                    setupData.configurationRecorders = data.ConfigurationRecorders; 
                    callback();
                }
            });
        },
        function () {
            if (setupData.configurationRecorders.length) {
                return false;
            } else {
                logger("No configuration recorders setup for '" + setupData.region + "'.");
                setupData.region = setupData.supportedRegions.pop();
                return true;
            }
        },
        function (err) {
            if (err) {
                logger("describeConfigurationRecorders failed for region '" + setupData.region + "'. Error: " + err);
                resultCallback(err);
            } else {
                AWS.config.update({region: setupData.region});

                var awsConfig       = new AWS.ConfigService();
                awsConfig.describeDeliveryChannels(function (err, data) {
                    if (err) {
                        logger("describeDeliveryChannels failed for region '" + setupData.region + "'. Error: " + err);
                        resultCallback(err); 
                    } else {
                        setupData.deliveryChannels = data.DeliveryChannels;
                        logger("Found valid AWS Config setup -" +
                                         "\n\tRecorder: " + JSON.stringify(setupData.configurationRecorders) +
                                         "\n\tDeliveryChannels: " + JSON.stringify(setupData.deliveryChannels));
                        resultCallback(null, setupData);
                    }
                });
            }
        });
}

function setupAwsConfigRecorder(setupData, resultCallback) {
    "use strict";

    var AWS    = setupData.aws,
        logger = setupData.logger;
    AWS.config.update({region: setupData.setupRegion});

    var awsConfig       = new AWS.ConfigService(),
        async           = require('async');
    async.waterfall([
        function(callback) {
            /*
             * Create configuration recorder
             */
            var  params = {
                ConfigurationRecorder: {
                    name: "default",
                    recordingGroup: {
                        allSupported: true
                    },
                    roleARN: setupData.configurationRecorders[0].roleARN
                }
            };

            awsConfig.putConfigurationRecorder(params, function(err, result) {
                if (err) {
                    return callback(err);
                } else {
                    return callback(null);
                }
            });
        },
        function(callback) {
            /*
             * Create delivery channel
             */
            var params = {
                DeliveryChannel: {
                    name: "default",
                    s3BucketName: setupData.deliveryChannels[0].s3BucketName,
                    snsTopicARN: setupData.deliveryChannels[0].snsTopicARN
                }
            };
            awsConfig.putDeliveryChannel(params, function(err, data) { 
                if (err) {
                    return callback(err);
                } else {
                    return callback(null);
                }
            });
        },
        function(callback) {
            awsConfig.startConfigurationRecorder({ConfigurationRecorderName: "default"}, function(err, data) {
                if (err) {
                    return callback(err);
                } else {
                    return callback(null);
                }
            });
        }
        ],
        function(err, result) {
            if (err) {
                logger("Failed to configure AWS Config for '" + setupData.setupRegion + "'. Error: " + JSON.stringify(err));
                return resultCallback(err);
            } else {
                logger("Successfully configured AWS Config for '" + setupData.setupRegion + "'.");
                return resultCallback(null, setupData);
            }
        });
}

function deliverSnapshot(setupData, resultCallback) {
    "use strict";

    var AWS = setupData.aws,
        logger = setupData.logger;
    AWS.config.update({region: setupData.setupRegion});

    var awsConfig       = new AWS.ConfigService();

    /*
     * Schedule configuration snapshot delivery.
     */
    awsConfig.deliverConfigSnapshot({deliveryChannelName: "default"}, function(err, data) {
        if (err) {
            switch (err.code) {
                case "ThrottlingException":
                    logger("Delivery of a configuration snapshot was already scheduled.");
                    return resultCallback(null, setupData);
                default:
                    logger("Failed to schedule delivery of a configuration snapshot. Error: " + JSON.stringify(err));
                    return resultCallback(err);
            }
        } else {
            logger("Successfully scheduled delivery of a configuration snapshot. configSnapshotId: " + data.configSnapshotId);
            return resultCallback(null, setupData);
        }
    });
}

module.exports = {
    discoverRecorder: discoverAwsConfigRecorder,
    setupRecorder:  setupAwsConfigRecorder,
    createSnapshot: deliverSnapshot
};
