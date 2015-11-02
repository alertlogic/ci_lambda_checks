/*
 * The setup performs the following actions:
 * Setup AWS Config recording for the specified region and return SNS Topic ARN configured for AWS Config.
 * If the AWS Config already setup properly, but doesn't have recording on or doesn publish updates to the SNS Topic,
 * ensure that recording is on and the Topic is setup.
 * In addition, setup lambda custom checks function to receive and process SNS notifications from AWS Config.
 */
var async           = require('async'),
    awsConfigSetup  = require('./awsconfig_setup.js'),
    roleSetup       = require('./role_setup.js'),
    s3Setup         = require('./s3_setup.js'),
    snsSetup        = require('./sns_setup.js'),
    lambdaSetup     = require('./lambda_setup.js'),
    awsRegions      = ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-northeast-1'];
    // awsRegions      = ['us-east-1', 'us-west-1', 'us-west-2', 'eu-west-1', 'eu-central-1', 'ap-southeast-1', 'ap-southeast-2', 'ap-northeast-1', 'sa-east-1'],

var defaultLambdaRoleName       = 'cloudinsight_custom_checks_lambda_role',
    defaultFunctionName         = 'ci_checks',
    defaultDriverHandlerName    = 'driver.handler',
    defaultWorkerHandlerName    = 'worker.handler';

var deploy = function(deploymentSpec, callback) {
    "use strict";

    var awsAccounts = Object.getOwnPropertyNames(deploymentSpec.awsAccounts);
    async.filter(awsAccounts,
        function (awsAccountId, filterCallback) {
            isValidEnvironment(awsAccountId, deploymentSpec.awsAccounts[awsAccountId].profile, filterCallback);
        },
        function (results) {
            // Remove all invalid accounts
            console.log("Removing invalid accounts: " + results.toString());
            for (var i = 0; i < results.length; i++) {
                delete deploymentSpec.awsAccounts[results[i]];
            }

            // Deploy to all valid accounts
            awsRegions.reverse();
            async.each(Object.getOwnPropertyNames(deploymentSpec.awsAccounts),
                function(awsAccountId, eachCallback) {
                    var params = {
                        "accountId":    deploymentSpec.accountId,
                        "awsAccountId": awsAccountId,
                        "profile":      deploymentSpec.awsAccounts[awsAccountId].profile,
                        "file":         deploymentSpec.file,
                        "regions":      deploymentSpec.awsAccounts[awsAccountId].regions.filter(isSupportedRegion)
                    };
                    deployAccount(params, eachCallback);
                },
                function(err) {
                    console.log("Finished deploying custom checks.");
                    callback(err);
                }
            );
        }
    );
};

function isValidEnvironment(awsAccountId, profile, callback) {
    "use strict";
    var AWS = new require('aws-sdk');
    if (profile && profile.length > 0) {
        var credentials = new AWS.SharedIniFileCredentials({profile: profile});
        AWS.config.credentials = credentials;
    }

    var iam = new AWS.IAM({apiVersion: '2010-05-08'});
    iam.getUser({}, function(err, data) { 
        if (err) {
            console.log("Failed to lookup user specified by '" + profile + "' profile. " +
                        "Skipping deployment for '" + awsAccountId + "' account.  Error: '" + err.message + "'.");
            callback(true);
        } else {
            var user = data.User;
            if (user.Arn.split(":")[4] === awsAccountId) {
                callback(false);
            } else {
                console.log("Skipping deploymeny for '" + awsAccountId + "' account. Credentials specified in '" +
                            profile + "' profile didn't match target account. " +
                            "Account referenced in profile credentials '" + user.Arn.split(":")[4] +
                            "'. Account referenced: " + awsAccountId);
                callback(true);
            }
        }
    });
}

function deployAccount(params, resultCallback) {
    "use strict";
    var accountId       = params.accountId,
        awsAccountId    = params.awsAccountId,
        regions         = params.regions,
        profile         = params.profile,
        file            = params.file,
        logger          = function(msg) {
            console.log("[AccountId: " + awsAccountId + "] " + msg);
        };

    logger("Ensuring proper AWS Config setup and deploying CloudInsight custom checks lambda function" +
            " to the '" + regions.toString() + "' regions. params: " + JSON.stringify(params));

    async.forEachOf(regions, function(regionName, _index, callback) {
        var params = {
            "accountId":    accountId,
            "awsAccountId": awsAccountId,
            "profile":      profile,
            "file":         file,
            "region":       regionName
        };

        deployRegion(params, logger, function(err) {
                return callback(err);
        });
    },
    function(err) {
        if (err) {
            logger("Errors occurred. Deployment aborted.");
        } else {
            logger("SUCCESS! " +
                   "AWS Config setup and CloudInsight custom checks lambda function deployment completed for '" +
                   regions.toString() + " regions in the '" + awsAccountId + "' AWS account.");
        }
        resultCallback();
    });
}

function deployRegion(params, logger, callback) {
    "use strict";
    var AWS             = new require('aws-sdk');
    if (params.profile && params.profile.length > 0) {
        var credentials = new AWS.SharedIniFileCredentials({profile: params.profile});
        AWS.config.credentials = credentials;
    }

    var code = require('fs').readFileSync(
                                require('path').resolve(
                                    __dirname,
                                    '../target/' + params.file));
    var setupData       = {
            aws:    AWS,
            region: params.region,
            setupRegion: params.region,
            accountId: params.awsAccountId,
            supportedRegions: awsRegions,
            lambda: [
                {
                    functionName:   defaultFunctionName + "_" + "driver_" + params.accountId,
                    description:    "CloudInsight Custom Checks Driver",
                    handler:        defaultDriverHandlerName,
                    roleName:       defaultLambdaRoleName,
                    runtime:        'nodejs',
                    timeout:        300,
                    subscribe:      true,
                    zipFile:        code
                },
                {
                    functionName:   defaultFunctionName + "_" + "worker_" + params.accountId,
                    description:    "CloudInsight Custom Checks Worker",
                    handler:        defaultWorkerHandlerName,
                    roleName:       defaultLambdaRoleName,
                    runtime:        'nodejs',
                    timeout:        300,
                    subscribe:      false,
                    zipFile:        code
                }
            ],
            logger: function(msg) {
                logger("[region: " + params.region + "] " + msg);
            }
        },
        setupAwsConfig  = async.seq(
                            roleSetup.getLambdaRole,
                            awsConfigSetup.discoverRecorder,
                            s3Setup.getBucket,
                            snsSetup.getTopic,
                            roleSetup.getConfigRole,
                            lambdaSetup.createFunction,
                            lambdaSetup.enableSnsPublishing,
                            snsSetup.createLambdaSubscription,
                            awsConfigSetup.setupRecorder,
                            awsConfigSetup.createSnapshot
                            );

    setupAwsConfig(setupData, function(err, result) {
            if (err) {
                setupData.logger("Failed to setup custom checks. Error: " + JSON.stringify(err));
                return callback(err);
            } else {
                setupData.logger(
                    "AWS Config setup and CloudInsight custom checks lambda function deployment completed.");
                return callback();
            }
    });
}

function isSupportedRegion(regionName) {
    "use strict";
    if (awsRegions.indexOf(regionName) === -1) {
        return false;
    }
    return true;
}

module.exports = deploy;
